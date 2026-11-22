import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { parsePluginConfigDescriptor } = await jiti.import("./plugin-config-descriptor.ts");
const {
  findPluginConfigDescriptor,
  PluginConfigError,
  readPluginConfig,
  writePluginConfig,
} = await jiti.import("./plugin-config.ts");

const FILE_DESCRIPTOR = parsePluginConfigDescriptor({
  storage: { type: "file", file: "demo-plugin.json" },
  fields: [
    { key: "on", type: "boolean", default: true },
    { key: "size", type: "integer", default: 10, min: 1, max: 100 },
    { key: "label", type: "string", default: "" },
    { key: "mode", type: "enum", default: "a", options: [{ value: "a" }, { value: "b" }] },
    { key: "list", type: "strings", default: [] },
  ],
}).descriptor;

const SETTINGS_DESCRIPTOR = parsePluginConfigDescriptor({
  storage: { type: "settings", namespace: "demoPlugin", locations: ["global"] },
  fields: [
    { key: "enabled", type: "boolean", default: false },
    { key: "nested.value", type: "integer", default: 3, min: 0, max: 10 },
  ],
}).descriptor;

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-plugin-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    agentDir: join(root, "agent"),
    cwd: join(root, "project"),
    configDir: ".pi",
  };
  await mkdir(paths.agentDir, { recursive: true });
  await mkdir(paths.cwd, { recursive: true });
  return { root, paths, bundledDir: join(root, "bundled") };
}

function row(layer, key) {
  return layer.fields.find((field) => field.key === key);
}

test("the plugin's own descriptor wins over the user's, which wins over the bundled one", async (t) => {
  const { root, paths, bundledDir } = await sandbox(t);
  const packageDir = join(root, "package");
  await mkdir(join(bundledDir, ""), { recursive: true });
  await mkdir(join(paths.agentDir, "plugin-configs"), { recursive: true });
  await mkdir(packageDir, { recursive: true });
  const storage = (file) => ({ type: "file", file });
  const write = (path, file) => writeFile(path, JSON.stringify({
    storage: storage(file),
    fields: [{ key: "on", type: "boolean", default: true }],
  }));
  const userPath = join(paths.agentDir, "plugin-configs", "demo-plugin.json");
  const bundledPath = join(bundledDir, "demo-plugin.json");
  await write(bundledPath, "bundled.json");
  await write(userPath, "user.json");
  await write(join(packageDir, "pi.config.json"), "package.json");

  const found = findPluginConfigDescriptor("npm:demo-plugin@1.0.0", { packageDir, agentDir: paths.agentDir, bundledDir });
  assert.equal(found.origin, "package");
  assert.deepEqual(found.descriptor.storage, { type: "file", file: "package.json", locations: ["global", "project"] });

  await rm(join(packageDir, "pi.config.json"));
  assert.equal(findPluginConfigDescriptor("npm:demo-plugin", { packageDir, agentDir: paths.agentDir, bundledDir }).origin, "user");

  await rm(userPath);
  assert.equal(findPluginConfigDescriptor("npm:demo-plugin", { packageDir, agentDir: paths.agentDir, bundledDir }).origin, "bundled");

  // A non-npm source has no name to look up.
  assert.deepEqual(findPluginConfigDescriptor("/local/plugin", { packageDir, agentDir: paths.agentDir, bundledDir }), {});
});

test("a descriptor that does not parse stops the search and names the file", async (t) => {
  const { root, paths, bundledDir } = await sandbox(t);
  const packageDir = join(root, "package");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "pi.config.json"), JSON.stringify({ fields: [] }));
  await mkdir(bundledDir, { recursive: true });
  await writeFile(join(bundledDir, "demo-plugin.json"), JSON.stringify({
    storage: { type: "file", file: "bundled.json" },
    fields: [{ key: "on", type: "boolean", default: true }],
  }));

  const found = findPluginConfigDescriptor("npm:demo-plugin", { packageDir, agentDir: paths.agentDir, bundledDir });
  assert.equal(found.descriptor, undefined, "falling through would render a form that writes other keys");
  assert.match(found.error, /pi\.config\.json: storage/);
});

test("a layer that sets nothing shows the default, marked as such", async (t) => {
  const { paths } = await sandbox(t);
  const config = readPluginConfig(FILE_DESCRIPTOR, paths, "bundled");

  assert.deepEqual(config.storage, { type: "file", file: "demo-plugin.json" });
  assert.deepEqual(config.locations, ["global", "project"]);
  const size = row(config.layers.project, "size");
  assert.equal(size.value, 10);
  assert.equal(size.from, "default");
  assert.equal(size.set, false);
  assert.equal(config.layers.global.path, join(paths.agentDir, "demo-plugin.json"));
  assert.equal(config.layers.project.path, join(paths.cwd, ".pi", "demo-plugin.json"));
});

test("a key the project leaves alone shows the global value the plugin uses", async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(join(paths.agentDir, "demo-plugin.json"), JSON.stringify({ size: 42, mode: "b" }));

  const config = readPluginConfig(FILE_DESCRIPTOR, paths, "bundled");
  const size = row(config.layers.project, "size");
  assert.equal(size.value, 42, "the project inherits the global value");
  assert.equal(size.from, "global");
  assert.equal(size.set, false);
  const mode = row(config.layers.project, "mode");
  assert.equal(mode.value, "b");
  assert.equal(mode.from, "global");
});

test("a project value wins in its own layer and is named in the global one", async (t) => {
  const { paths } = await sandbox(t);
  await mkdir(join(paths.cwd, ".pi"), { recursive: true });
  await writeFile(join(paths.agentDir, "demo-plugin.json"), JSON.stringify({ size: 42 }));
  await writeFile(join(paths.cwd, ".pi", "demo-plugin.json"), JSON.stringify({ size: 80, on: false }));

  const config = readPluginConfig(FILE_DESCRIPTOR, paths, "bundled");
  const projectSize = row(config.layers.project, "size");
  assert.equal(projectSize.value, 80);
  assert.equal(projectSize.from, "project");
  assert.equal(projectSize.set, true);

  const globalSize = row(config.layers.global, "size");
  assert.equal(globalSize.value, 42);
  assert.deepEqual(globalSize.overridden, { scope: "project", value: 80 });

  // A key only the global layer sets is still shown as the value in force there.
  assert.equal(row(config.layers.global, "label").value, "");
  assert.equal(row(config.layers.global, "label").overridden, undefined);
  assert.deepEqual(row(config.layers.global, "on").overridden, { scope: "project", value: false });
});

test("a value the plugin would ignore reads as unset, not as a stray value", async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(join(paths.agentDir, "demo-plugin.json"), JSON.stringify({ size: 500, label: 7 }));
  const config = readPluginConfig(FILE_DESCRIPTOR, paths, "bundled");
  assert.equal(row(config.layers.global, "size").value, 10);
  assert.equal(row(config.layers.global, "size").set, false);
  assert.equal(row(config.layers.global, "label").value, "");
  assert.equal(row(config.layers.global, "label").set, false);
});

test("a file that does not parse is reported and keeps the layer on defaults", async (t) => {
  const { paths } = await sandbox(t);
  const path = join(paths.agentDir, "demo-plugin.json");
  await writeFile(path, "{ not json");
  const layer = readPluginConfig(FILE_DESCRIPTOR, paths, "bundled").layers.global;
  assert.ok(layer.error?.startsWith(`${path}: `), layer.error);
  assert.equal(row(layer, "size").value, 10);
});

test("a settings layer reads its namespace and leaves pi's own settings alone", async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(join(paths.agentDir, "settings.json"), JSON.stringify({
    defaultModel: "m",
    demoPlugin: { enabled: true, nested: { value: 7 } },
  }));

  const config = readPluginConfig(SETTINGS_DESCRIPTOR, paths, "bundled");
  assert.deepEqual(config.locations, ["global"], "the descriptor says the plugin reads only this layer");
  assert.equal(config.layers.global.path, join(paths.agentDir, "settings.json"));
  assert.equal(row(config.layers.global, "enabled").value, true);
  assert.equal(row(config.layers.global, "nested.value").value, 7);
  assert.deepEqual(config.layers.project.fields, [], "a layer the plugin does not read has no rows");

  await writePluginConfig(SETTINGS_DESCRIPTOR, paths, "global", { values: { "nested.value": 9 } });
  const settings = JSON.parse(await readFile(join(paths.agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings, { defaultModel: "m", demoPlugin: { enabled: true, nested: { value: 9 } } });

  await writePluginConfig(SETTINGS_DESCRIPTOR, paths, "global", { remove: ["enabled", "nested.value"] });
  assert.deepEqual(JSON.parse(await readFile(join(paths.agentDir, "settings.json"), "utf8")), { defaultModel: "m" });
});

test("a save writes the submitted keys, removes the dropped ones, and keeps every other key", async (t) => {
  const { paths } = await sandbox(t);
  const path = join(paths.cwd, ".pi", "demo-plugin.json");
  await mkdir(join(paths.cwd, ".pi"), { recursive: true });
  await writeFile(path, JSON.stringify({ size: 3, futureKey: "kept" }));

  await writePluginConfig(FILE_DESCRIPTOR, paths, "project", {
    values: { on: false, mode: "b", list: ["a", "b"] },
    remove: ["size"],
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    futureKey: "kept",
    on: false,
    mode: "b",
    list: ["a", "b"],
  });
  assert.deepEqual(
    JSON.parse(await readFile(join(paths.agentDir, "demo-plugin.json"), "utf8").catch(() => "{}")),
    {},
    "the other layer is not touched",
  );
});

test("a save refuses a key the plugin does not know, a value it would ignore, and a layer it does not read", async (t) => {
  const { paths } = await sandbox(t);
  const path = join(paths.agentDir, "demo-plugin.json");

  for (const [changes, pattern] of [
    [{ values: { colour: true } }, /Unknown key/],
    [{ values: { size: 500 } }, /size/],
    [{ values: { size: 1.5 } }, /size/],
    [{ values: { mode: "z" } }, /mode/],
    [{ values: { on: "yes" } }, /on/],
    [{ remove: ["colour"] }, /Unknown key/],
    [{ values: "not an object" }, /values must be an object/],
    [{ remove: "size" }, /remove must be a list/],
    [{ values: { nested: {} } }, /Unknown key/],
  ]) {
    await assert.rejects(
      writePluginConfig(FILE_DESCRIPTOR, paths, "global", changes),
      (error) => error instanceof PluginConfigError && pattern.test(error.message),
      JSON.stringify(changes),
    );
  }
  await assert.rejects(
    writePluginConfig(SETTINGS_DESCRIPTOR, paths, "project", { values: { enabled: true } }),
    /does not read the project layer/,
  );
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" }, "a refused save creates nothing");
});

test("a save refuses a file it cannot parse rather than replacing it", async (t) => {
  const { paths } = await sandbox(t);
  const path = join(paths.agentDir, "demo-plugin.json");
  await writeFile(path, "{ not json");
  await assert.rejects(
    writePluginConfig(FILE_DESCRIPTOR, paths, "global", { values: { size: 20 } }),
    (error) => error instanceof PluginConfigError && error.message.startsWith(`${path}: `),
  );
  assert.equal(await readFile(path, "utf8"), "{ not json");
});
