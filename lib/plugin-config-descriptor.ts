/**
 * The descriptor format for a plugin's settings form.
 *
 * Pi has no extension-settings namespace (an extension reads its own file, or
 * a namespace of pi's settings.json), so a web form needs a declarative answer
 * to two questions: where the values live, and what each key means. A
 * descriptor is that answer — data, never code:
 *
 *   <package>/pi.config.json                     the plugin's own copy
 *   <agent dir>/plugin-configs/<package>.json    the user's copy
 *   <app>/plugin-configs/<package>.json          the copy Pi Web ships
 *
 * Those are tried in that order, most authoritative first. Everything here
 * validates a descriptor before the panel renders a single control: a typo in
 * a bundled file must not become a form that writes the wrong value.
 */

import type { PluginConfigFieldKind, PluginScope } from "@/lib/api-types";

/** Where one layer of values lives; `project` reads `<cwd>/.pi`. */
export type PluginConfigStorage =
  | { type: "file"; file: string; locations: PluginScope[] }
  | { type: "settings"; namespace: string; locations: PluginScope[] };

export interface PluginConfigFieldOption {
  value: string;
  labels?: Record<string, string>;
}

export interface PluginConfigFieldDescriptor {
  /** A dotted path into the layer (`chainCompression.enabled`). */
  key: string;
  kind: PluginConfigFieldKind;
  /** What the plugin uses when the layer does not set the key. */
  default: boolean | number | string | string[] | null;
  /** The plugin accepts a JSON null here; an empty field means "not set". */
  nullable: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  control: "switch" | "slider" | "number" | "text" | "select" | "list";
  unit?: string;
  options?: PluginConfigFieldOption[];
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  /** The value only applies while another key holds `equals`, said as a note. */
  dependsOn?: { key: string; equals: string | number | boolean };
}

export interface PluginConfigDescriptor {
  storage: PluginConfigStorage;
  fields: PluginConfigFieldDescriptor[];
}

export interface ParsedDescriptor {
  descriptor?: PluginConfigDescriptor;
  error?: string;
}

const KINDS: readonly PluginConfigFieldKind[] = ["boolean", "integer", "number", "string", "enum", "strings"];
const CONTROLS: Record<PluginConfigFieldKind, readonly PluginConfigFieldDescriptor["control"][]> = {
  boolean: ["switch"],
  integer: ["slider", "number"],
  number: ["slider", "number"],
  string: ["text"],
  enum: ["select"],
  strings: ["list"],
};
const DEFAULT_CONTROL: Record<PluginConfigFieldKind, PluginConfigFieldDescriptor["control"]> = {
  boolean: "switch",
  integer: "number",
  number: "number",
  string: "text",
  enum: "select",
  strings: "list",
};

/** A bare JSON file name: the values file the plugin reads in the agent dir and `.pi`. */
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*\.json$/;
/** A settings namespace or a field path: dotted identifiers. */
const PATH_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]*(\.[A-Za-z0-9_$-]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A label as written: one string for every locale, or a map keyed by locale. */
function readLabels(value: unknown, where: string): Record<string, string> | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim() ? { en: value } : undefined;
  if (!isRecord(value)) return `${where}: expected a string or an object of locale strings`;
  const labels: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== "string") return `${where}.${locale}: expected a string`;
    if (text.trim()) labels[locale] = text;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function readNumber(value: unknown, where: string): number | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${where}: expected a number`;
  return value;
}

function readLocations(value: unknown): PluginScope[] | string {
  if (value === undefined) return ["global", "project"];
  if (!Array.isArray(value) || value.length === 0) return "storage.locations: expected global and/or project";
  const locations: PluginScope[] = [];
  for (const entry of value) {
    if (entry !== "global" && entry !== "project") return `storage.locations: unknown scope ${JSON.stringify(entry)}`;
    if (!locations.includes(entry)) locations.push(entry);
  }
  return locations;
}

function readStorage(value: unknown): PluginConfigStorage | string {
  if (!isRecord(value)) return "storage: expected an object";
  const locations = readLocations(value.locations);
  if (typeof locations === "string") return locations;
  if (value.type === "file") {
    if (typeof value.file !== "string" || !FILE_NAME.test(value.file)) {
      return "storage.file: expected a bare JSON file name such as pi-image-slim.json";
    }
    return { type: "file", file: value.file, locations };
  }
  if (value.type === "settings") {
    if (typeof value.namespace !== "string" || !PATH_KEY.test(value.namespace)) {
      return "storage.namespace: expected a settings key such as contextPrune";
    }
    return { type: "settings", namespace: value.namespace, locations };
  }
  return 'storage.type: expected "file" or "settings"';
}

/** A parse that may fail; a string is never a value here, so the two cannot be confused. */
type Parsed<T> = { value: T } | { error: string };

/** The default a field states, checked against its own kind. */
function readDefault(
  value: unknown,
  kind: PluginConfigFieldKind,
  nullable: boolean,
): Parsed<boolean | number | string | string[] | null> {
  if (value === undefined) return { error: "default: required" };
  if (value === null) {
    return nullable ? { value: null } : { error: "default: null needs \"nullable\": true" };
  }
  if (kind === "boolean") return typeof value === "boolean" ? { value } : { error: "default: expected true or false" };
  if (kind === "integer") {
    return typeof value === "number" && Number.isInteger(value) ? { value } : { error: "default: expected a whole number" };
  }
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value) ? { value } : { error: "default: expected a number" };
  }
  if (kind === "string") return typeof value === "string" ? { value } : { error: "default: expected a string" };
  if (kind === "enum") return typeof value === "string" ? { value } : { error: "default: expected one of the option values" };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { error: "default: expected a list of strings" };
  }
  return { value: [...value] as string[] };
}

function readField(raw: unknown, index: number, keys: Set<string>): PluginConfigFieldDescriptor | string {
  const where = `fields[${index}]`;
  if (!isRecord(raw)) return `${where}: expected an object`;
  if (typeof raw.key !== "string" || !PATH_KEY.test(raw.key)) {
    return `${where}.key: expected a dotted key such as quality or chainCompression.enabled`;
  }
  const key = raw.key;
  if (keys.has(key)) return `${where}.key: duplicate key ${key}`;
  if (typeof raw.type !== "string" || !(KINDS as readonly string[]).includes(raw.type)) {
    return `${where}.type: expected ${KINDS.join(", ")}`;
  }
  const kind = raw.type as PluginConfigFieldKind;
  const nullable = raw.nullable === true;
  const parsedDefault = readDefault(raw.default, kind, nullable);
  if ("error" in parsedDefault) return `${where}.${parsedDefault.error}`;
  const fallback = parsedDefault.value;

  const control = raw.control === undefined ? DEFAULT_CONTROL[kind] : raw.control;
  if (typeof control !== "string" || !(CONTROLS[kind] as readonly string[]).includes(control)) {
    return `${where}.control: expected ${CONTROLS[kind].join(" or ")} for a ${kind}`;
  }

  const min = readNumber(raw.min, `${where}.min`);
  if (typeof min === "string") return min;
  const max = readNumber(raw.max, `${where}.max`);
  if (typeof max === "string") return max;
  const step = readNumber(raw.step, `${where}.step`);
  if (typeof step === "string") return step;
  const maxLength = readNumber(raw.maxLength, `${where}.maxLength`);
  if (typeof maxLength === "string") return maxLength;
  if ((min !== undefined || max !== undefined) && kind !== "integer" && kind !== "number") {
    return `${where}.min: only a number field has a range`;
  }
  if (min !== undefined && max !== undefined && min > max) return `${where}.min: greater than max`;
  if (step !== undefined && step <= 0) return `${where}.step: expected a positive number`;
  if (maxLength !== undefined && (kind !== "string" || maxLength <= 0)) return `${where}.maxLength: expected a positive whole number on a string`;
  if (kind === "integer" && typeof fallback === "number") {
    if (min !== undefined && fallback < min) return `${where}.default: below min`;
    if (max !== undefined && fallback > max) return `${where}.default: above max`;
  }

  const labels = readLabels(raw.label, `${where}.label`);
  if (typeof labels === "string") return labels;
  const descriptions = readLabels(raw.description, `${where}.description`);
  if (typeof descriptions === "string") return descriptions;
  if (raw.unit !== undefined && typeof raw.unit !== "string") return `${where}.unit: expected a string`;

  let options: PluginConfigFieldOption[] | undefined;
  if (kind === "enum") {
    if (!Array.isArray(raw.options) || raw.options.length === 0) return `${where}.options: expected a non-empty list`;
    options = [];
    for (const [optionIndex, option] of raw.options.entries()) {
      if (!isRecord(option) || typeof option.value !== "string") {
        return `${where}.options[${optionIndex}].value: expected a string`;
      }
      if (options.some((existing) => existing.value === option.value)) {
        return `${where}.options[${optionIndex}].value: duplicate ${option.value}`;
      }
      const optionLabels = readLabels(option.label, `${where}.options[${optionIndex}].label`);
      if (typeof optionLabels === "string") return optionLabels;
      options.push(optionLabels ? { value: option.value, labels: optionLabels } : { value: option.value });
    }
    const values = options.map((option) => option.value);
    if (typeof fallback === "string" && !values.includes(fallback)) return `${where}.default: not one of options`;
  } else if (raw.options !== undefined) {
    return `${where}.options: only an enum has options`;
  }

  let dependsOn: PluginConfigFieldDescriptor["dependsOn"];
  if (raw.dependsOn !== undefined) {
    if (!isRecord(raw.dependsOn) || typeof raw.dependsOn.key !== "string" || raw.dependsOn.key === key) {
      return `${where}.dependsOn: expected { "key": "<another field>", "equals": <value> }`;
    }
    const equals = raw.dependsOn.equals;
    if (typeof equals !== "boolean" && typeof equals !== "number" && typeof equals !== "string") {
      return `${where}.dependsOn.equals: expected a string, number or boolean`;
    }
    dependsOn = { key: raw.dependsOn.key, equals };
  }

  return {
    key,
    kind,
    default: fallback,
    nullable,
    min,
    max,
    step,
    maxLength,
    control: control as PluginConfigFieldDescriptor["control"],
    ...(raw.unit === undefined ? {} : { unit: raw.unit as string }),
    ...(options ? { options } : {}),
    ...(labels ? { labels } : {}),
    ...(descriptions ? { descriptions } : {}),
    ...(dependsOn ? { dependsOn } : {}),
  };
}

/** Validate one parsed descriptor file; a refusal names the offending member. */
export function parsePluginConfigDescriptor(raw: unknown): ParsedDescriptor {
  if (!isRecord(raw)) return { error: "expected a JSON object" };
  const storage = readStorage(raw.storage);
  if (typeof storage === "string") return { error: storage };
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) return { error: "fields: expected a non-empty list" };
  if (raw.fields.length > 200) return { error: "fields: at most 200 entries" };

  const fields: PluginConfigFieldDescriptor[] = [];
  const keys = new Set<string>();
  for (const [index, entry] of raw.fields.entries()) {
    const field = readField(entry, index, keys);
    if (typeof field === "string") return { error: field };
    keys.add(field.key);
    fields.push(field);
  }
  for (const field of fields) {
    if (field.dependsOn && !keys.has(field.dependsOn.key)) {
      return { error: `fields: ${field.key} depends on unknown key ${field.dependsOn.key}` };
    }
  }
  return { descriptor: { storage, fields } };
}
