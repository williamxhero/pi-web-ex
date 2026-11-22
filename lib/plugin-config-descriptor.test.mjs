import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { parsePluginConfigDescriptor } = await createJiti(import.meta.url, { moduleCache: false })
  .import("./plugin-config-descriptor.ts");

const labels = { en: "Quality", "zh-CN": "质量" };

function descriptor(fields, storage = { type: "file", file: "example.json" }) {
  return { storage, fields };
}

function errorOf(raw) {
  const parsed = parsePluginConfigDescriptor(raw);
  assert.ok(parsed.error, `expected a refusal, got ${JSON.stringify(parsed.descriptor)}`);
  return parsed.error;
}

test("a file descriptor defaults to both layers and to the control its kind implies", () => {
  const parsed = parsePluginConfigDescriptor(descriptor([
    { key: "on", type: "boolean", default: true, label: "On" },
    { key: "size", type: "integer", default: 3, min: 1, max: 10 },
    { key: "note", type: "string", default: "" },
    { key: "mode", type: "enum", default: "a", options: [{ value: "a", label: labels }, { value: "b" }] },
    { key: "paths", type: "strings", default: ["a"] },
  ]));
  assert.equal(parsed.error, undefined, parsed.error);
  const fields = parsed.descriptor.fields;
  assert.deepEqual(parsed.descriptor.storage.locations, ["global", "project"]);
  assert.deepEqual(fields.map((field) => field.control), ["switch", "number", "text", "select", "list"]);
  assert.deepEqual(fields[0].labels, { en: "On" }, "a plain string is the English label");
  assert.deepEqual(fields[3].options[0].labels, labels);
});

test("a settings descriptor names its namespace and may limit the layers it reads", () => {
  const parsed = parsePluginConfigDescriptor(descriptor(
    [{ key: "chain.enabled", type: "boolean", default: true }],
    { type: "settings", namespace: "contextPrune", locations: ["global"] },
  ));
  assert.equal(parsed.error, undefined, parsed.error);
  assert.deepEqual(parsed.descriptor.storage, { type: "settings", namespace: "contextPrune", locations: ["global"] });
  assert.equal(parsed.descriptor.fields[0].key, "chain.enabled");
});

test("a null default is only allowed when the field says it is nullable", () => {
  assert.match(errorOf(descriptor([{ key: "x", type: "number", default: null }])), /nullable/);
  const parsed = parsePluginConfigDescriptor(descriptor([
    { key: "x", type: "number", default: null, nullable: true, min: 0, max: 1 },
  ]));
  assert.equal(parsed.error, undefined, parsed.error);
  assert.equal(parsed.descriptor.fields[0].default, null);
});

test("the storage and the fields are checked by name", () => {
  for (const [raw, pattern] of [
    [null, /object/],
    [{ fields: [] }, /storage/],
    [descriptor([], { type: "file", file: "../outside.json" }), /bare JSON file name/],
    [descriptor([], { type: "file", file: "example.json", locations: ["agent"] }), /locations/],
    [descriptor([], { type: "settings", namespace: "has space" }), /namespace/],
    [descriptor([]), /fields/],
    [descriptor([{ type: "boolean", default: true }]), /key/],
    [descriptor([{ key: "a", type: "float", default: 1 }]), /type/],
    [descriptor([{ key: "a", type: "boolean" }]), /default/],
    [descriptor([{ key: "a", type: "integer", default: 1.5 }]), /whole number/],
    [descriptor([{ key: "a", type: "integer", default: 5, min: 0, max: 3 }]), /above max/],
    [descriptor([{ key: "a", type: "boolean", default: true }, { key: "a", type: "boolean", default: false }]), /duplicate/],
    [descriptor([{ key: "a", type: "boolean", default: true, control: "slider" }]), /control/],
    [descriptor([{ key: "a", type: "boolean", default: true, options: [{ value: "x" }] }]), /only an enum/],
    [descriptor([{ key: "a", type: "enum", default: "c", options: [{ value: "a" }] }]), /one of options/],
    [descriptor([{ key: "a", type: "enum", default: "a", options: [] }]), /non-empty/],
    [descriptor([{ key: "a", type: "string", default: "", min: 1 }]), /only a number field/],
    [descriptor([{ key: "a", type: "boolean", default: true, dependsOn: { key: "missing", equals: true } }]), /unknown key/],
    [descriptor([{ key: "a", type: "boolean", default: true, label: { en: 3 } }]), /label/],
  ]) {
    assert.match(errorOf(raw), pattern);
  }
});

test("every descriptor Pi Web ships parses and carries English labels", () => {
  const dir = join(process.cwd(), "plugin-configs");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 3, files.join(", "));
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const parsed = parsePluginConfigDescriptor(raw);
    assert.equal(parsed.error, undefined, `${file}: ${parsed.error}`);
    for (const field of parsed.descriptor.fields) {
      assert.ok(field.labels?.en, `${file}: ${field.key} has no English label`);
      assert.ok(field.labels?.["zh-CN"], `${file}: ${field.key} has no Chinese label`);
    }
  }
});
