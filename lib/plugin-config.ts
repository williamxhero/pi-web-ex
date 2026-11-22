/**
 * Reading and writing the settings a plugin's descriptor points at.
 *
 * A descriptor says where the values live (`file` in the agent dir and `.pi`,
 * or a namespace of pi's `settings.json`) and what each key means. This module
 * turns that into two things: the rows the Plugins pane shows, and a validated
 * write that touches only the keys it was asked to.
 *
 * Values are layered the way the plugin reads them: default, then the global
 * layer, then the project layer. Each row reports the value in force and where
 * it came from, so a key the project does not set shows the global value the
 * plugin will actually use. A save writes only the keys the form marks as set
 * in the layer being edited, and can remove keys so a row inherits again.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import type {
  PluginConfigFieldInfo,
  PluginConfigInfo,
  PluginConfigLayerInfo,
  PluginConfigValue,
  PluginScope,
} from "@/lib/api-types";
import { updateGlobalSettings } from "./global-settings-file";
import { parseNpmSource } from "./npm-source";
import {
  parsePluginConfigDescriptor,
  type PluginConfigDescriptor,
  type PluginConfigFieldDescriptor,
  type PluginConfigStorage,
} from "./plugin-config-descriptor";

/** A refused descriptor, value or rewrite; the route answers 400. */
export class PluginConfigError extends Error {}

export interface PluginConfigPaths {
  agentDir: string;
  cwd: string;
  /** pi's project config folder name (`.pi`), from `CONFIG_DIR_NAME`. */
  configDir: string;
}

export type DescriptorOrigin = "package" | "user" | "bundled";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(path: string): { object: Record<string, unknown>; error?: string } {
  if (!existsSync(path)) return { object: {} };
  let text: string;
  try {
    // As pi reads it: Windows PowerShell 5.1 and Notepad may write a byte-order mark.
    text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
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

/**
 * The name a descriptor is looked up by: an npm source already carries one,
 * while a git checkout or a local folder carries it in its own package.json.
 */
function descriptorName(source: string, packageDir: string | undefined): string | undefined {
  const npm = parseNpmSource(source)?.name;
  if (npm) return npm;
  if (!packageDir) return undefined;
  const manifest = readJsonObject(join(packageDir, "package.json"));
  if (manifest.error) return undefined;
  const name = manifest.object.name;
  return typeof name === "string" && name.trim() && !/[\\/]/.test(name) ? name.trim() : undefined;
}

/** Every path a descriptor may be read from, most authoritative first. */
function descriptorCandidates(
  source: string,
  paths: { packageDir?: string; agentDir: string; bundledDir: string },
): { origin: DescriptorOrigin; path: string }[] {
  const name = descriptorName(source, paths.packageDir);
  if (!name) return [];
  const candidates: { origin: DescriptorOrigin; path: string }[] = [];
  if (paths.packageDir) candidates.push({ origin: "package", path: join(paths.packageDir, "pi.config.json") });
  candidates.push({ origin: "user", path: join(paths.agentDir, "plugin-configs", `${name}.json`) });
  candidates.push({ origin: "bundled", path: join(paths.bundledDir, `${name}.json`) });
  return candidates;
}

/**
 * The descriptor for a configured package: the plugin's own `pi.config.json`,
 * then the user's copy in the agent dir, then the one Pi Web ships. A file that
 * exists but does not validate stops the search and is reported — falling
 * through to a different copy would show a form that writes other keys.
 */
export function findPluginConfigDescriptor(
  source: string,
  paths: { packageDir?: string; agentDir: string; bundledDir: string },
): { descriptor?: PluginConfigDescriptor; origin?: DescriptorOrigin; path?: string; error?: string } {
  for (const candidate of descriptorCandidates(source, paths)) {
    if (!existsSync(candidate.path)) continue;
    const { object, error } = readJsonObject(candidate.path);
    if (error) return { error };
    const parsed = parsePluginConfigDescriptor(object);
    if (parsed.error) return { error: `${candidate.path}: ${parsed.error}` };
    return { descriptor: parsed.descriptor, origin: candidate.origin, path: candidate.path };
  }
  return {};
}

/** The dotted path of a key, read out of a layer's object. */
function readKey(object: Record<string, unknown>, key: string): { present: boolean; value: unknown } {
  let current: unknown = object;
  for (const part of key.split(".")) {
    if (!isRecord(current) || !(part in current)) return { present: false, value: undefined };
    current = current[part];
  }
  return { present: true, value: current };
}

/** Write a dotted key, creating the objects on the way. */
function writeKey(object: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let current = object;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Delete a dotted key and any object it leaves empty. */
function deleteKey(object: Record<string, unknown>, key: string): void {
  const parts = key.split(".");
  const trail: Record<string, unknown>[] = [object];
  let current = object;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) return;
    current = next;
    trail.push(current);
  }
  delete current[parts[parts.length - 1]];
  for (let index = trail.length - 1; index > 0; index -= 1) {
    if (Object.keys(trail[index]).length > 0) break;
    const parent = trail[index - 1];
    const name = parts[index - 1];
    if (parent[name] !== trail[index]) break;
    delete parent[name];
  }
}

/** The JSON value a field accepts, or undefined when the plugin would ignore it. */
function acceptedValue(field: PluginConfigFieldDescriptor, raw: unknown): PluginConfigValue | undefined {
  if (raw === null) return field.nullable ? null : undefined;
  if (field.kind === "boolean") return typeof raw === "boolean" ? raw : undefined;
  if (field.kind === "string") {
    if (typeof raw !== "string") return undefined;
    return field.maxLength !== undefined && raw.length > field.maxLength ? undefined : raw;
  }
  if (field.kind === "strings") {
    return Array.isArray(raw) && raw.every((entry) => typeof entry === "string") ? [...raw as string[]] : undefined;
  }
  if (field.kind === "enum") {
    if (typeof raw !== "string") return undefined;
    return field.options?.some((option) => option.value === raw) ? raw : undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (field.kind === "integer") {
    if (!Number.isInteger(raw)) return undefined;
    if (field.min !== undefined && raw < field.min) return undefined;
    if (field.max !== undefined && raw > field.max) return undefined;
    return raw;
  }
  if (field.min !== undefined && raw < field.min) return undefined;
  if (field.max !== undefined && raw > field.max) return undefined;
  return raw;
}

/** The value a submitted form may write, or a refusal naming the key. */
function submittedValue(field: PluginConfigFieldDescriptor, raw: unknown): PluginConfigValue {
  const accepted = acceptedValue(field, raw);
  if (accepted !== undefined) return accepted;
  if (raw === null) throw new PluginConfigError(`${field.key} cannot be null`);
  if (field.kind === "boolean") throw new PluginConfigError(`${field.key} must be true or false`);
  if (field.kind === "string") {
    throw new PluginConfigError(
      field.maxLength === undefined
        ? `${field.key} must be a string`
        : `${field.key} must be a string of at most ${field.maxLength} characters`,
    );
  }
  if (field.kind === "strings") throw new PluginConfigError(`${field.key} must be a list of strings`);
  if (field.kind === "enum") throw new PluginConfigError(`${field.key} must be one of its options`);
  if (field.kind === "integer") {
    throw new PluginConfigError(
      `${
        field.key
      } must be a whole number from ${field.min ?? Number.MIN_SAFE_INTEGER} to ${field.max ?? Number.MAX_SAFE_INTEGER}`,
    );
  }
  throw new PluginConfigError(
    `${field.key} must be a number from ${field.min ?? Number.MIN_SAFE_INTEGER} to ${field.max ?? Number.MAX_SAFE_INTEGER}`,
  );
}

/** Where one layer's values live. */
export function pluginConfigLayerPath(
  storage: PluginConfigStorage,
  paths: PluginConfigPaths,
  scope: PluginScope,
): string {
  if (storage.type === "file") {
    return scope === "project"
      ? join(paths.cwd, paths.configDir, storage.file)
      : join(paths.agentDir, storage.file);
  }
  return scope === "project"
    ? join(paths.cwd, paths.configDir, "settings.json")
    : join(paths.agentDir, "settings.json");
}

/**
 * One layer's object: the settings file whole, or the descriptor's namespace
 * inside it. A namespace holding something other than an object is an error,
 * not an empty layer, because the plugin would refuse it too.
 */
function readLayerObject(
  descriptor: PluginConfigDescriptor,
  paths: PluginConfigPaths,
  scope: PluginScope,
): { path: string; object: Record<string, unknown>; error?: string } {
  const path = pluginConfigLayerPath(descriptor.storage, paths, scope);
  const read = readJsonObject(path);
  if (read.error) return { path, object: {}, error: read.error };
  if (descriptor.storage.type === "file") return { path, object: read.object };
  const found = readKey(read.object, descriptor.storage.namespace);
  if (!found.present) return { path, object: {} };
  if (!isRecord(found.value)) {
    return { path, object: {}, error: `${path}: ${descriptor.storage.namespace} is not an object` };
  }
  return { path, object: found.value };
}

/**
 * The rows of one layer: the value in force (this layer, else the global one,
 * else the default), where it came from, and whether this layer sets it.
 */
function layerInfo(
  descriptor: PluginConfigDescriptor,
  paths: PluginConfigPaths,
  scope: PluginScope,
  global: { object: Record<string, unknown> },
  project: { object: Record<string, unknown> },
): PluginConfigLayerInfo {
  const layer = readLayerObject(descriptor, paths, scope);
  const own = scope === "global" ? global.object : project.object;
  const ancestor = scope === "global" ? undefined : global.object;

  const fields: PluginConfigFieldInfo[] = descriptor.fields.map((field) => {
    const ownValue = readKey(own, field.key);
    const ownAccepted = ownValue.present ? acceptedValue(field, ownValue.value) : undefined;
    const set = ownValue.present && ownAccepted !== undefined;
    const inherited = ancestor ? readKey(ancestor, field.key) : { present: false, value: undefined };
    const inheritedAccepted = ancestor && inherited.present ? acceptedValue(field, inherited.value) : undefined;
    const later = scope === "global" ? readKey(project.object, field.key) : { present: false, value: undefined };
    const laterAccepted = scope === "global" && later.present ? acceptedValue(field, later.value) : undefined;

    const value = set ? ownAccepted as PluginConfigValue : inheritedAccepted !== undefined
      ? inheritedAccepted
      : field.default;
    const from: "default" | PluginScope = set ? scope : inheritedAccepted !== undefined ? "global" : "default";

    return {
      key: field.key,
      kind: field.kind,
      ...(field.labels ? { labels: field.labels } : {}),
      ...(field.descriptions ? { descriptions: field.descriptions } : {}),
      ...(field.min === undefined ? {} : { min: field.min }),
      ...(field.max === undefined ? {} : { max: field.max }),
      ...(field.step === undefined ? {} : { step: field.step }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
      control: field.control,
      ...(field.unit === undefined ? {} : { unit: field.unit }),
      ...(field.options ? { options: field.options } : {}),
      nullable: field.nullable,
      ...(field.dependsOn ? { dependsOn: field.dependsOn } : {}),
      value,
      default: field.default,
      from,
      set,
      ...(laterAccepted !== undefined ? { overridden: { scope: "project" as const, value: laterAccepted } } : {}),
    };
  });

  return layer.error ? { path: layer.path, error: layer.error, fields } : { path: layer.path, fields };
}

/** Both layers of a package's settings, ready for the form. */
export function readPluginConfig(
  descriptor: PluginConfigDescriptor,
  paths: PluginConfigPaths,
  origin: DescriptorOrigin,
): PluginConfigInfo {
  const global = readLayerObject(descriptor, paths, "global");
  const project = readLayerObject(descriptor, paths, "project");
  const locations = descriptor.storage.locations;
  const empty = (scope: PluginScope): PluginConfigLayerInfo => {
    const layer = readLayerObject(descriptor, paths, scope);
    return layer.error ? { path: layer.path, error: layer.error, fields: [] } : { path: layer.path, fields: [] };
  };
  return {
    origin,
    storage: descriptor.storage.type === "file"
      ? { type: "file", file: descriptor.storage.file }
      : { type: "settings", namespace: descriptor.storage.namespace },
    locations,
    layers: {
      global: locations.includes("global")
        ? layerInfo(descriptor, paths, "global", global, project)
        : empty("global"),
      project: locations.includes("project")
        ? layerInfo(descriptor, paths, "project", global, project)
        : empty("project"),
    },
  };
}

/**
 * The changes a save may apply, checked against the descriptor before anything
 * is created, locked or written.
 */
function validatedChanges(
  descriptor: PluginConfigDescriptor,
  changes: { values?: unknown; remove?: unknown },
): { values: [string, PluginConfigValue][]; remove: string[] } {
  const fields = new Map(descriptor.fields.map((field) => [field.key, field]));
  const rawValues = changes.values === undefined ? {} : changes.values;
  if (!isRecord(rawValues)) throw new PluginConfigError("values must be an object");
  const remove = changes.remove === undefined ? [] : changes.remove;
  if (!Array.isArray(remove) || remove.some((entry) => typeof entry !== "string")) {
    throw new PluginConfigError("remove must be a list of keys");
  }
  for (const key of [...Object.keys(rawValues), ...remove]) {
    if (!fields.has(key)) throw new PluginConfigError(`Unknown key for this plugin: ${key}`);
  }
  return {
    values: Object.entries(rawValues).map(([key, raw]) => [
      key,
      submittedValue(fields.get(key) as PluginConfigFieldDescriptor, raw),
    ]),
    remove: remove as string[],
  };
}

function applyChanges(
  object: Record<string, unknown>,
  changes: { values: [string, PluginConfigValue][]; remove: string[] },
): void {
  for (const [key, value] of changes.values) writeKey(object, key, value);
  for (const key of changes.remove) deleteKey(object, key);
}

/**
 * Write the layer being edited: only the submitted keys are set, only the
 * listed keys are removed, and every other key in the file is left as it is
 * (an unknown key may belong to a newer plugin version). A file that does not
 * parse is refused, never replaced.
 */
export async function writePluginConfig(
  descriptor: PluginConfigDescriptor,
  paths: PluginConfigPaths,
  scope: PluginScope,
  requested: { values?: unknown; remove?: unknown },
): Promise<void> {
  if (!descriptor.storage.locations.includes(scope)) {
    throw new PluginConfigError(`This plugin does not read the ${scope} layer`);
  }
  const changes = validatedChanges(descriptor, requested);
  const path = pluginConfigLayerPath(descriptor.storage, paths, scope);
  const descriptorStorage = descriptor.storage;

  if (descriptorStorage.type === "settings") {
    // pi's own settings file: the lock and the preserve-every-other-key rule
    // are global-settings-file.ts's, the same write pi's SettingsManager makes.
    await updateGlobalSettings(path, (settings) => {
      const found = readKey(settings, descriptorStorage.namespace);
      if (found.present && !isRecord(found.value)) {
        throw new PluginConfigError(`${path}: ${descriptorStorage.namespace} is not an object`);
      }
      const namespace = found.present ? found.value as Record<string, unknown> : {};
      if (!found.present) writeKey(settings, descriptorStorage.namespace, namespace);
      applyChanges(namespace, changes);
      if (Object.keys(namespace).length === 0) deleteKey(settings, descriptorStorage.namespace);
    });
    return;
  }

  // Refuse what cannot be rewritten before anything is created or locked.
  if (existsSync(path)) {
    let regular = false;
    try {
      regular = statSync(path).isFile();
    } catch {
      regular = false;
    }
    if (!regular) throw new PluginConfigError(`${path}: not a regular file`);
    const existing = readJsonObject(path);
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
    const { object, error } = readJsonObject(path);
    if (error) throw new PluginConfigError(error);
    applyChanges(object, changes);
    writeFileSync(path, JSON.stringify(object, null, 2), "utf8");
  } finally {
    await release();
  }
}
