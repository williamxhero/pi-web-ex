/**
 * Configuration for installed plugins that keep a JSON settings file of their
 * own.
 *
 * Pi has no per-extension settings namespace and `pi.getSettings()` is
 * read-only, so a plugin's settings are its own file: pi-image-slim reads
 * `<agent dir>/pi-image-slim.json` and `<cwd>/.pi/pi-image-slim.json`, project
 * last (its README's configuration table). Pi Web can therefore only offer a
 * form for a plugin whose file and keys it knows, which is what the
 * definitions below are: one entry per supported plugin, kept in step with
 * that plugin's own defaults and ranges.
 *
 * Nothing here runs plugin code. A definition only says where the file is and
 * which keys the form may write; a key an extension also reads from elsewhere
 * is still the extension's own business.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import type {
  PluginConfigFieldInfo,
  PluginConfigInfo,
  PluginConfigScopeInfo,
  PluginConfigValue,
  PluginScope,
} from "@/lib/api-types";
import { parseNpmSource } from "./npm-source";

export interface PluginConfigFieldDefinition {
  key: string;
  kind: "boolean" | "integer";
  /** i18n key of the field's name; a locale may translate it, the key is the fallback. */
  labelKey: string;
  /** i18n key of one line saying what the value does; omitted leaves the row to its label. */
  descriptionKey?: string;
  /** What the extension uses when its file does not set the key. */
  default: boolean | number;
  /** Integers only: the range the extension accepts, inclusive. */
  min?: number;
  max?: number;
  /** Integers only: `slider` for a short range, `number` for a wide one. */
  control?: "slider" | "number";
  /** Shown after the value, such as `px`. */
  unit?: string;
}

export interface PluginConfigDefinition {
  /** The npm package name the file belongs to; matched as `npm:<name>` or `npm:<name>@<version>`. */
  packageName: string;
  /** The file the plugin reads in `<agent dir>` and in `<cwd>/<CONFIG_DIR_NAME>`. */
  fileName: string;
  fields: readonly PluginConfigFieldDefinition[];
}

/** A refused value, or a file this module will not overwrite; the route answers 400. */
export class PluginConfigError extends Error {}

/**
 * Defaults and ranges from pi-image-slim's `config.ts` (`DEFAULTS`, and the
 * bounds its `asInteger()` accepts). It reads its file on every hook call, so a
 * save applies without a reload. A default that drifts only changes what an
 * unset key shows; it never writes that value unless the form is saved.
 */
const IMAGE_SLIM: PluginConfigDefinition = {
  packageName: "pi-image-slim",
  fileName: "pi-image-slim.json",
  fields: [
    {
      key: "compress",
      kind: "boolean",
      labelKey: "plugins.config.imageSlim.compress",
      descriptionKey: "plugins.config.imageSlim.compressDescription",
      default: true,
    },
    {
      key: "strip",
      kind: "boolean",
      labelKey: "plugins.config.imageSlim.strip",
      descriptionKey: "plugins.config.imageSlim.stripDescription",
      default: false,
    },
    {
      key: "caption",
      kind: "boolean",
      labelKey: "plugins.config.imageSlim.caption",
      descriptionKey: "plugins.config.imageSlim.captionDescription",
      default: true,
    },
    {
      key: "keepTurns",
      kind: "integer",
      labelKey: "plugins.config.imageSlim.keepTurns",
      descriptionKey: "plugins.config.imageSlim.keepTurnsDescription",
      default: 1,
      min: 1,
      max: 20,
      control: "slider",
    },
    {
      key: "maxKeptImages",
      kind: "integer",
      labelKey: "plugins.config.imageSlim.maxKeptImages",
      descriptionKey: "plugins.config.imageSlim.maxKeptImagesDescription",
      default: 0,
      min: 0,
      max: 200,
    },
    {
      key: "maxEdge",
      kind: "integer",
      labelKey: "plugins.config.imageSlim.maxEdge",
      descriptionKey: "plugins.config.imageSlim.maxEdgeDescription",
      default: 1280,
      min: 1,
      max: 20_000,
      unit: "px",
    },
    {
      key: "quality",
      kind: "integer",
      labelKey: "plugins.config.imageSlim.quality",
      descriptionKey: "plugins.config.imageSlim.qualityDescription",
      default: 75,
      min: 0,
      max: 100,
      control: "slider",
    },
    {
      key: "captionTimeoutMs",
      kind: "integer",
      labelKey: "plugins.config.imageSlim.captionTimeoutMs",
      descriptionKey: "plugins.config.imageSlim.captionTimeoutMsDescription",
      default: 20_000,
      min: 0,
      max: 600_000,
      unit: "ms",
    },
  ],
};

const DEFINITIONS: readonly PluginConfigDefinition[] = [IMAGE_SLIM];

/** The file definition for a configured package source, or undefined when none is known. */
export function pluginConfigDefinition(source: string): PluginConfigDefinition | undefined {
  const name = parseNpmSource(source)?.name;
  return name ? DEFINITIONS.find((definition) => definition.packageName === name) : undefined;
}

/**
 * Where a scope's file lives: `<agent dir>` for every project, or the project's
 * `.pi` folder. The project file refines the user one, so both can exist.
 */
export function pluginConfigPath(
  definition: PluginConfigDefinition,
  paths: { agentDir: string; configDir: string; cwd: string },
  scope: PluginScope,
): string {
  return scope === "project"
    ? join(paths.cwd, paths.configDir, definition.fileName)
    : join(paths.agentDir, definition.fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The file's own object, or why it cannot be read as one. A missing or blank
 * file reads as `{}` (the plugin itself ignores both); anything that does not
 * parse is an error, and a write then refuses rather than replacing bytes the
 * user still has to repair by hand.
 */
function readConfigObject(path: string): { object: Record<string, unknown>; error?: string } {
  if (!existsSync(path)) return { object: {} };
  let text: string;
  try {
    // As pi reads it: Windows PowerShell 5.1 and Notepad may write a byte-order mark.
    text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    // A directory there, or a file this process may not read: the form says so
    // and Save stays off, rather than the route failing with a 500.
    const reason = error instanceof Error ? error.message : String(error);
    return { object: {}, error: `${path}: ${reason}` };
  }
  if (!text.trim()) return { object: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { object: {}, error: `${path}: ${reason}` };
  }
  if (!isRecord(parsed)) return { object: {}, error: `${path}: expected a JSON object` };
  return { object: parsed };
}

/** The value the plugin's reader would accept for this key, rounded as it rounds. */
function storedValue(field: PluginConfigFieldDefinition, raw: unknown): PluginConfigValue | undefined {
  if (field.kind === "boolean") return typeof raw === "boolean" ? raw : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const rounded = Math.round(raw);
  if (field.min !== undefined && rounded < field.min) return undefined;
  if (field.max !== undefined && rounded > field.max) return undefined;
  return rounded;
}

/** The value a submitted form may write, or a refusal naming the key. */
function submittedValue(field: PluginConfigFieldDefinition, raw: unknown): PluginConfigValue {
  if (field.kind === "boolean") {
    if (typeof raw !== "boolean") throw new PluginConfigError(`${field.key} must be true or false`);
    return raw;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new PluginConfigError(`${field.key} must be a whole number`);
  }
  const value = storedValue(field, raw);
  if (value === undefined) {
    throw new PluginConfigError(
      `${
        field.key
      } must be between ${field.min ?? Number.MIN_SAFE_INTEGER} and ${field.max ?? Number.MAX_SAFE_INTEGER}`,
    );
  }
  return value;
}

function scopeInfo(
  definition: PluginConfigDefinition,
  path: string,
): PluginConfigScopeInfo {
  const { object, error } = readConfigObject(path);
  const fields: PluginConfigFieldInfo[] = definition.fields.map((field) => {
    const stored = storedValue(field, object[field.key]);
    return {
      key: field.key,
      kind: field.kind,
      labelKey: field.labelKey,
      descriptionKey: field.descriptionKey,
      min: field.min,
      max: field.max,
      control: field.control,
      unit: field.unit,
      value: stored ?? field.default,
      default: field.default,
      set: stored !== undefined,
    };
  });
  return error ? { path, error, fields } : { path, fields };
}

/**
 * Both files' values for the panel: each scope shows its own file over the
 * defaults, never the merged result, because that is what saving there writes.
 * The form says when the other file refines these values.
 */
export function readPluginConfig(
  definition: PluginConfigDefinition,
  paths: { agentDir: string; configDir: string; cwd: string },
): PluginConfigInfo {
  return {
    fileName: definition.fileName,
    scopes: {
      global: scopeInfo(definition, pluginConfigPath(definition, paths, "global")),
      project: scopeInfo(definition, pluginConfigPath(definition, paths, "project")),
    },
  };
}

/**
 * Merge submitted values into one scope's file and write it back, keeping every
 * key the file already holds (including ones a newer plugin version added).
 * The file is locked while it is rewritten, since an editor may hold it open;
 * pi itself never writes it.
 */
export async function writePluginConfig(
  definition: PluginConfigDefinition,
  paths: { agentDir: string; configDir: string; cwd: string },
  scope: PluginScope,
  values: Record<string, unknown>,
): Promise<void> {
  const submitted: Record<string, PluginConfigValue> = {};
  for (const [key, raw] of Object.entries(values)) {
    const field = definition.fields.find((candidate) => candidate.key === key);
    if (!field) throw new PluginConfigError(`Unknown key for ${definition.fileName}: ${key}`);
    submitted[key] = submittedValue(field, raw);
  }
  if (Object.keys(submitted).length === 0) return;

  const path = pluginConfigPath(definition, paths, scope);
  // Refuse what cannot be rewritten before anything is created or locked: a
  // folder where the file belongs, or a file that does not parse.
  if (existsSync(path)) {
    let regular = false;
    try {
      regular = statSync(path).isFile();
    } catch {
      regular = false;
    }
    if (!regular) throw new PluginConfigError(`${path}: not a regular file`);
    const existing = readConfigObject(path);
    if (existing.error) throw new PluginConfigError(existing.error);
  }
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, "", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(path, { realpath: false, retries: 10 });
  try {
    const { object, error } = readConfigObject(path);
    if (error) throw new PluginConfigError(error);
    writeFileSync(path, JSON.stringify({ ...object, ...submitted }, null, 2), "utf8");
  } finally {
    await release();
  }
}
