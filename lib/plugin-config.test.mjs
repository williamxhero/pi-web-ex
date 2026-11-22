import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { pluginConfigDefinition, PluginConfigError, readPluginConfig, writePluginConfig } = await jiti
  .import("./plugin-config.ts");

const definition = pluginConfigDefinition("npm:pi-image-slim");
assert.ok(definition, "pi-image-slim has a definition");

async function configDirs(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-plugin-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  return { root, paths: { agentDir, cwd, configDir: ".pi" } };
}

function values(scope) {
  return Object.fromEntries(scope.fields.map((field) => [field.key, field.value]));
}

test("a package is matched through npm:<name> and a pinned version, and other sources are not", () => {
  assert.equal(pluginConfigDefinition("npm:pi-image-slim"), definition);
  assert.equal(pluginConfigDefinition("npm:pi-image-slim@1.2.3"), definition);
  assert.equal(pluginConfigDefinition("npm:pi-other"), undefined);
  assert.equal(pluginConfigDefinition("git:github.com/user/pi-image-slim"), undefined);
  assert.equal(pluginConfigDefinition("/absolute/path/pi-image-slim"), undefined);
});

test("a missing file reads as the plugin's own defaults, set by nothing", async (t) => {
  const { paths } = await configDirs(t);
  const config = readPluginConfig(definition, paths);

  assert.equal(config.fileName, definition.fileName);
  assert.equal(config.scopes.global.path, join(paths.agentDir, definition.fileName));
  assert.equal(config.scopes.project.path, join(paths.cwd, ".pi", definition.fileName));
  assert.equal(config.scopes.global.error, undefined);
  assert.deepEqual(values(config.scopes.global), {
    compress: true,
    strip: false,
    caption: true,
    keepTurns: 1,
    maxKeptImages: 0,
    maxEdge: 1280,
    quality: 75,
    captionTimeoutMs: 20_000,
  });
  assert.deepEqual(config.scopes.global.fields.filter((field) => field.set), []);
});

test("each scope shows its own file, never the merged result, since that is what saving there writes", async (t) => {
  const { paths } = await configDirs(t);
  await writeFile(join(paths.agentDir, definition.fileName), JSON.stringify({ quality: 50, strip: true }));
  await mkdir(join(paths.cwd, ".pi"), { recursive: true });
  await writeFile(join(paths.cwd, ".pi", definition.fileName), JSON.stringify({ quality: 90 }));

  const config = readPluginConfig(definition, paths);
  assert.equal(values(config.scopes.global).quality, 50);
  assert.equal(values(config.scopes.global).strip, true);
  assert.equal(values(config.scopes.project).quality, 90);
  // The project file says nothing about strip, so it shows the default there.
  assert.equal(values(config.scopes.project).strip, false);
  assert.deepEqual(
    config.scopes.global.fields.filter((field) => field.set).map((field) => field.key),
    ["strip", "quality"],
  );
});

test("a value the plugin would ignore reads as the default and is not marked as set", async (t) => {
  const { paths } = await configDirs(t);
  await writeFile(
    join(paths.agentDir, definition.fileName),
    // quality is out of range, keepTurns is a string, maxEdge is rounded as the plugin rounds it.
    JSON.stringify({ quality: 500, keepTurns: "3", maxEdge: 999.6 }),
  );

  const fields = Object.fromEntries(
    readPluginConfig(definition, paths).scopes.global.fields.map((field) => [field.key, field]),
  );
  assert.equal(fields.quality.value, 75);
  assert.equal(fields.quality.set, false);
  assert.equal(fields.keepTurns.value, 1);
  assert.equal(fields.keepTurns.set, false);
  assert.equal(fields.maxEdge.value, 1000);
  assert.equal(fields.maxEdge.set, true);
});

test("a file with a byte-order mark is read, as pi reads it", async (t) => {
  const { paths } = await configDirs(t);
  await writeFile(join(paths.agentDir, definition.fileName), `\uFEFF${JSON.stringify({ quality: 40 })}`);
  assert.equal(values(readPluginConfig(definition, paths).scopes.global).quality, 40);
});

test("a blank file reads as defaults, and saving there fills it in", async (t) => {
  const { paths } = await configDirs(t);
  const path = join(paths.agentDir, definition.fileName);
  await writeFile(path, "\n");

  assert.equal(values(readPluginConfig(definition, paths).scopes.global).quality, 75);
  await writePluginConfig(definition, paths, "global", { quality: 60 });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { quality: 60 });
});

test("a save into the project keeps its own keys and every key the file already holds", async (t) => {
  const { paths } = await configDirs(t);
  const path = join(paths.cwd, ".pi", definition.fileName);
  await mkdir(join(paths.cwd, ".pi"), { recursive: true });
  // An unknown key belongs to a newer plugin version: it survives a save.
  await writeFile(path, JSON.stringify({ strip: true, futureKey: "kept" }));

  await writePluginConfig(definition, paths, "project", { quality: 90, caption: false });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    strip: true,
    futureKey: "kept",
    quality: 90,
    caption: false,
  });
  const config = readPluginConfig(definition, paths);
  assert.equal(values(config.scopes.project).strip, true);
  assert.equal(values(config.scopes.project).quality, 90);
  assert.equal(values(config.scopes.global).quality, 75, "the user file is not touched");
});

test("a file that does not parse is reported with its path, and a save refuses rather than replacing it", async (t) => {
  const { paths } = await configDirs(t);
  const path = join(paths.agentDir, definition.fileName);
  await writeFile(path, "{ not json");

  const scope = readPluginConfig(definition, paths).scopes.global;
  assert.equal(scope.fields.find((field) => field.key === "quality").value, 75);
  assert.ok(scope.error?.startsWith(`${path}: `), scope.error);

  await assert.rejects(
    writePluginConfig(definition, paths, "global", { quality: 60 }),
    (error) => error instanceof PluginConfigError && error.message.startsWith(`${path}: `),
  );
  assert.equal(await readFile(path, "utf8"), "{ not json");
});

test("a path that is not a readable file is reported, not thrown", async (t) => {
  const { paths } = await configDirs(t);
  // A folder where the file belongs: exists, but cannot be read as JSON.
  await mkdir(join(paths.agentDir, definition.fileName));

  const scope = readPluginConfig(definition, paths).scopes.global;
  assert.ok(scope.error?.startsWith(join(paths.agentDir, definition.fileName)), scope.error);
  assert.equal(scope.fields.find((field) => field.key === "quality").value, 75);

  await assert.rejects(
    writePluginConfig(definition, paths, "global", { quality: 60 }),
    (error) => error instanceof PluginConfigError,
  );
});

test("a save refuses a key the definition does not know, and a value the plugin would ignore", async (t) => {
  const { paths } = await configDirs(t);
  const path = join(paths.agentDir, definition.fileName);

  await assert.rejects(
    writePluginConfig(definition, paths, "global", { colour: true }),
    (error) => error instanceof PluginConfigError && /Unknown key/.test(error.message),
  );
  for (const [key, value] of [["quality", 101], ["quality", 60.5], ["keepTurns", 0], ["compress", "yes"]]) {
    await assert.rejects(
      writePluginConfig(definition, paths, "global", { [key]: value }),
      (error) => error instanceof PluginConfigError,
      `${key}=${String(value)}`,
    );
  }
  // Nothing was created by a refused save.
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
});

test("a save of no keys writes nothing at all", async (t) => {
  const { paths } = await configDirs(t);
  await writePluginConfig(definition, paths, "global", {});
  await assert.rejects(readFile(join(paths.agentDir, definition.fileName), "utf8"), { code: "ENOENT" });
});
