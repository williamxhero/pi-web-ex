import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-plugin-route-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(join(agentDir, "extensions"), { recursive: true });
await mkdir(cwd);
await writeFile(join(agentDir, "extensions", "rtk.ts"), "export default () => {};\n");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { trustProject } = await jiti.import("../../../lib/project-trust.ts");
const { GET, POST } = await jiti.import("./route.ts");
allowFileRoot(cwd);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

test("lists auto-discovered top-level extensions", async () => {
  const response = await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.packages, []);
  assert.deepEqual(body.standaloneExtensions, [{
    kind: "extension",
    name: "rtk",
    path: join(agentDir, "extensions", "rtk.ts"),
    relativePath: "extensions/rtk.ts",
    scope: "global",
    enabled: true,
  }]);
  assert.equal(body.totals.extensions, 1);
});

test("reports the package description from package.json", async () => {
  const packageDir = join(root, "pkg-with-description");
  await mkdir(join(packageDir, "extensions"), { recursive: true });
  await writeFile(join(packageDir, "package.json"), JSON.stringify({
    name: "pkg-with-description",
    version: "1.2.3",
    description: "Adds descriptions to the Plugins panel.",
  }));
  await writeFile(join(packageDir, "extensions", "index.ts"), "export default () => {};\n");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageDir] }));

  const response = await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`));
  const body = await response.json();

  assert.equal(response.status, 200);
  const installed = body.packages.find((pkg) => pkg.source === packageDir);
  assert.ok(installed, "configured package is listed");
  assert.equal(installed.description, "Adds descriptions to the Plugins panel.");
});

async function makePackage(name) {
  const packageDir = join(root, name);
  await mkdir(join(packageDir, "extensions"), { recursive: true });
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  await writeFile(join(packageDir, "extensions", "index.ts"), "export default () => {};\n");
  return packageDir;
}

const off = { extensions: [], skills: [], prompts: [], themes: [] };
const settingsPath = join(agentDir, "settings.json");

async function readPackages() {
  return JSON.parse(await readFile(settingsPath, "utf8")).packages;
}

function postPlugins(body, projectCwd = cwd) {
  return POST(new Request("http://localhost/api/plugins", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ cwd: projectCwd, ...body }),
  }));
}

test("bulk disable writes every listed package and reports each one", async () => {
  const [alpha, beta, gamma] = await Promise.all(["bulk-alpha", "bulk-beta", "bulk-gamma"].map(makePackage));
  await writeFile(settingsPath, JSON.stringify({
    packages: [alpha, { source: beta, ...off }, gamma],
  }));

  const response = await postPlugins({
    action: "disable",
    packages: [
      { source: alpha, scope: "global" },
      { source: beta, scope: "global" },
      { source: "npm:removed-since-load", scope: "global" },
    ],
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.results, [
    { source: alpha, scope: "global" },
    { source: beta, scope: "global" },
    { source: "npm:removed-since-load", scope: "global", error: "Package is not configured" },
  ]);
  // gamma was not listed, so the bulk write leaves it alone.
  assert.deepEqual(await readPackages(), [{ source: alpha, ...off }, { source: beta, ...off }, gamma]);
  const disabled = Object.fromEntries(body.packages.map((pkg) => [pkg.source, pkg.disabled]));
  assert.deepEqual(disabled, { [alpha]: true, [beta]: true, [gamma]: false });
});

test("bulk enable restores disabled packages and keeps a filtered one's filters", async () => {
  const [alpha, beta] = await Promise.all(["bulk-alpha", "bulk-beta"].map(makePackage));
  const filtered = { source: beta, extensions: ["extensions/index.ts"] };
  await writeFile(settingsPath, JSON.stringify({ packages: [{ source: alpha, ...off }, filtered] }));

  const response = await postPlugins({
    action: "enable",
    packages: [{ source: alpha, scope: "global" }, { source: beta, scope: "global" }],
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((result) => result.error), [undefined, undefined]);
  assert.deepEqual(await readPackages(), [alpha, filtered]);
});

test("bulk toggles refuse an untrusted project's packages without stopping global ones", async () => {
  const alpha = await makePackage("bulk-alpha");
  const untrusted = join(root, "untrusted-project");
  await mkdir(join(untrusted, ".pi"), { recursive: true });
  const projectSettings = JSON.stringify({ packages: ["npm:project-only"] });
  await writeFile(join(untrusted, ".pi", "settings.json"), projectSettings);
  allowFileRoot(untrusted);
  await writeFile(settingsPath, JSON.stringify({ packages: [alpha] }));

  const response = await postPlugins({
    action: "disable",
    packages: [{ source: alpha, scope: "global" }, { source: "npm:project-only", scope: "project" }],
  }, untrusted);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].error, undefined);
  assert.match(body.results[1].error, /must be trusted/);
  assert.deepEqual(await readPackages(), [{ source: alpha, ...off }]);
  assert.equal(await readFile(join(untrusted, ".pi", "settings.json"), "utf8"), projectSettings);
});

test("bulk toggles report a settings file the SDK could not load instead of success", async () => {
  const alpha = await makePackage("bulk-alpha");
  await writeFile(settingsPath, `{ "packages": ["${alpha}"]`);

  const response = await postPlugins({ action: "disable", packages: [{ source: alpha, scope: "global" }] });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.results[0].error.startsWith(settingsPath), body.results[0].error);
  assert.equal(await readFile(settingsPath, "utf8"), `{ "packages": ["${alpha}"]`);
  await writeFile(settingsPath, JSON.stringify({ packages: [] }));
});

test("bulk toggles reject malformed package lists and other actions", async () => {
  const notAList = await postPlugins({ action: "disable", packages: "npm:x" });
  assert.equal(notAList.status, 400);
  const missingSource = await postPlugins({ action: "disable", packages: [{ scope: "global" }] });
  assert.equal(missingSource.status, 400);
  const remove = await postPlugins({ action: "remove", packages: [{ source: "npm:x", scope: "global" }] });
  assert.equal(remove.status, 400);
});

test("bulk disable leaves a filtered package alone and says why", async () => {
  const [alpha, beta] = await Promise.all(["bulk-alpha", "bulk-beta"].map(makePackage));
  const filtered = { source: beta, extensions: ["extensions/index.ts"] };
  await writeFile(settingsPath, JSON.stringify({ packages: [alpha, filtered] }));

  const response = await postPlugins({
    action: "disable",
    packages: [{ source: alpha, scope: "global" }, { source: beta, scope: "global" }],
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].error, undefined);
  assert.match(body.results[1].error, /resource filters/);
  // Disabling would have emptied its lists, and enabling cannot restore them.
  assert.deepEqual(await readPackages(), [{ source: alpha, ...off }, filtered]);
});

test("enabling keeps an entry's own settings such as autoload", async () => {  const [alpha, beta] = await Promise.all(["bulk-alpha", "bulk-beta"].map(makePackage));
  await writeFile(settingsPath, JSON.stringify({
    packages: [{ source: alpha, autoload: false, ...off }, { source: beta, autoload: false, ...off }],
  }));

  const single = await postPlugins({ action: "enable", source: alpha, scope: "global" });
  assert.equal(single.status, 200);
  const bulk = await postPlugins({ action: "enable", packages: [{ source: beta, scope: "global" }] });
  assert.equal(bulk.status, 200);

  assert.deepEqual(await readPackages(), [{ source: alpha, autoload: false }, { source: beta, autoload: false }]);
});

test("a standalone extension gets its descriptor and is written through the extension target", async () => {
  const pluginFile = join(agentDir, "extensions", "loop-to-done.ts");
  const configPath = join(agentDir, "loop-to-done.json");
  const brokenFile = join(agentDir, "extensions", "broken-ext.ts");
  const brokenDescriptor = join(agentDir, "plugin-configs", "broken-ext.json");
  await writeFile(pluginFile, "export default () => {};\n");
  await writeFile(brokenFile, "export default () => {};\n");
  await mkdir(join(agentDir, "plugin-configs"), { recursive: true });
  await writeFile(brokenDescriptor, JSON.stringify({ fields: [] }));

  const listed = await (await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`))).json();
  const extension = listed.standaloneExtensions.find((item) => item.name === "loop-to-done");
  assert.ok(extension, "the loose extension is listed");
  assert.equal(extension.config.origin, "bundled");
  assert.equal(extension.config.layers.global.path, configPath);
  assert.equal(extension.config.layers.global.fields.find((field) => field.key === "autoStart").value, false);
  // A descriptor that does not validate leaves the row without a form and says why.
  const broken = listed.standaloneExtensions.find((item) => item.name === "broken-ext");
  assert.equal(broken.config, undefined);
  assert.ok(listed.diagnostics.some((entry) => entry.source === "broken-ext" && /storage/.test(entry.message)));

  const saved = await postPlugins({
    action: "set-config",
    extension: "loop-to-done",
    configScope: "global",
    values: { autoStart: true, maxTokens: 1200 },
  });
  const body = await saved.json();
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { autoStart: true, maxTokens: 1200 });
  const after = body.standaloneExtensions.find((item) => item.name === "loop-to-done");
  assert.deepEqual(
    after.config.layers.global.fields.filter((field) => field.set).map((field) => field.key).sort(),
    ["autoStart", "maxTokens"],
  );

  // Exactly one target is required: a package source or an extension name.
  const both = await postPlugins({
    action: "set-config",
    source: "npm:pi-image-slim",
    extension: "loop-to-done",
    configScope: "global",
    values: { quality: 10 },
  });
  assert.equal(both.status, 400);
  const neither = await postPlugins({ action: "set-config", configScope: "global", values: { quality: 10 } });
  assert.equal(neither.status, 400);

  await rm(pluginFile, { force: true });
  await rm(brokenFile, { force: true });
  await rm(brokenDescriptor, { force: true });
  await rm(configPath, { force: true });
});

test("a described plugin's settings are listed per layer and written through set-config", async () => {
  await writeFile(settingsPath, JSON.stringify({ packages: ["npm:pi-image-slim"] }));
  const configPath = join(agentDir, "pi-image-slim.json");

  const listed = await (await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(cwd)}`))).json();
  const known = listed.packages.find((pkg) => pkg.source === "npm:pi-image-slim");
  assert.deepEqual(known.config.storage, { type: "file", file: "pi-image-slim.json" });
  assert.deepEqual(known.config.locations, ["global", "project"]);
  assert.equal(known.config.origin, "bundled");
  assert.equal(known.config.layers.global.path, configPath);
  assert.equal(known.config.layers.project.path, join(cwd, ".pi", "pi-image-slim.json"));
  const quality = known.config.layers.global.fields.find((field) => field.key === "quality");
  assert.deepEqual(
    { value: quality.value, from: quality.from, set: quality.set, min: quality.min, max: quality.max },
    { value: 75, from: "default", set: false, min: 0, max: 100 },
  );

  const response = await postPlugins({
    action: "set-config",
    source: "npm:pi-image-slim",
    scope: "global",
    configScope: "global",
    values: { strip: true, quality: 80 },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { strip: true, quality: 80 });
  const saved = body.packages.find((pkg) => pkg.source === "npm:pi-image-slim").config.layers;
  assert.deepEqual(saved.global.fields.filter((field) => field.set).map((field) => field.key), ["strip", "quality"]);
  // The project layer inherits what the global file now says.
  const inherited = saved.project.fields.find((field) => field.key === "quality");
  assert.deepEqual({ value: inherited.value, from: inherited.from }, { value: 80, from: "global" });

  // Removing a key hands the row back to the default.
  const removed = await postPlugins({
    action: "set-config",
    source: "npm:pi-image-slim",
    scope: "global",
    configScope: "global",
    remove: ["quality"],
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { strip: true });

  // A value the plugin would ignore is refused, and the file keeps what it had.
  const refused = await postPlugins({
    action: "set-config",
    source: "npm:pi-image-slim",
    scope: "global",
    configScope: "global",
    values: { quality: 101 },
  });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /quality/);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { strip: true });

  // A package with no descriptor anywhere has no form to save from.
  const unknown = await postPlugins({
    action: "set-config",
    source: "npm:pi-condense-not-described",
    scope: "global",
    configScope: "global",
    values: { quality: 1 },
  });
  assert.equal(unknown.status, 400);

  await writeFile(settingsPath, JSON.stringify({ packages: [] }));
  await rm(configPath, { force: true });
});

test("a project-scoped standalone extension inherits the global layer and writes its own", async () => {
  const project = join(root, "extension-project");
  const extensionDir = join(project, ".pi", "extensions", "loop-to-done");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, "index.ts"), "export default () => {};\n");
  allowFileRoot(project);
  // A project `.pi/extensions` folder is exactly what needs a trust decision.
  trustProject(project, agentDir);

  const globalPath = join(agentDir, "loop-to-done.json");
  const projectPath = join(project, ".pi", "loop-to-done.json");
  assert.equal((await postPlugins({
    action: "set-config",
    extension: "loop-to-done",
    configScope: "global",
    values: { autoStart: true },
  }, project)).status, 200);

  const listed = await (await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(project)}`))).json();
  const extension = listed.standaloneExtensions.find((item) => item.name === "loop-to-done");
  assert.ok(extension, "the project extension is listed once the project is trusted");
  assert.equal(extension.scope, "project");
  assert.equal(extension.config.layers.global.path, globalPath);
  assert.equal(extension.config.layers.project.path, projectPath);
  const inherited = extension.config.layers.project.fields.find((field) => field.key === "autoStart");
  assert.deepEqual(
    { value: inherited.value, from: inherited.from, set: inherited.set },
    { value: true, from: "global", set: false },
  );

  const saved = await postPlugins({
    action: "set-config",
    extension: "loop-to-done",
    configScope: "project",
    values: { maxTokens: 900 },
  }, project);
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(await readFile(projectPath, "utf8")), { maxTokens: 900 });
  const after = (await saved.json()).standaloneExtensions.find((item) => item.name === "loop-to-done");
  const own = after.config.layers.project.fields.find((field) => field.key === "maxTokens");
  assert.deepEqual({ value: own.value, from: own.from, set: own.set }, { value: 900, from: "project", set: true });
  // The key the project leaves alone still follows the global layer.
  assert.equal(after.config.layers.project.fields.find((field) => field.key === "autoStart").from, "global");

  await rm(project, { recursive: true, force: true });
  await rm(globalPath, { force: true });
});

test("an untrusted project's standalone extension gets no form and no project write", async () => {
  const untrusted = join(root, "untrusted-extension-project");
  await mkdir(join(untrusted, ".pi", "extensions", "loop-to-done"), { recursive: true });
  await writeFile(join(untrusted, ".pi", "extensions", "loop-to-done", "index.ts"), "export default () => {};\n");
  allowFileRoot(untrusted);

  const listed = await (await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(untrusted)}`))).json();
  assert.equal(listed.projectResourcesLoaded, false);
  assert.equal(listed.standaloneExtensions.some((item) => item.name === "loop-to-done"), false);

  const refused = await postPlugins({
    action: "set-config",
    extension: "loop-to-done",
    configScope: "project",
    values: { autoStart: true },
  }, untrusted);
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /trusted/);
  assert.equal(existsSync(join(untrusted, ".pi", "loop-to-done.json")), false);

  await rm(untrusted, { recursive: true, force: true });
});

test("a folder extension's own descriptor writes the project settings namespace", async () => {
  const project = join(root, "settings-namespace-project");
  const extensionDir = join(project, ".pi", "extensions", "settings-ext");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, "index.ts"), "export default () => {};\n");
  await writeFile(join(extensionDir, "pi.config.json"), JSON.stringify({
    storage: { type: "settings", namespace: "settingsExt", locations: ["global", "project"] },
    fields: [{ key: "enabled", type: "boolean", default: false, label: { en: "Enabled" } }],
  }));
  allowFileRoot(project);
  trustProject(project, agentDir);

  const listed = await (await GET(new Request(`http://localhost/api/plugins?cwd=${encodeURIComponent(project)}`))).json();
  const extension = listed.standaloneExtensions.find((item) => item.name === "settings-ext");
  assert.ok(extension, "the folder extension is listed");
  assert.equal(extension.config.origin, "package");
  assert.deepEqual(extension.config.storage, { type: "settings", namespace: "settingsExt" });
  assert.equal(extension.config.layers.global.path, join(agentDir, "settings.json"));
  assert.equal(extension.config.layers.project.path, join(project, ".pi", "settings.json"));

  const saved = await postPlugins({
    action: "set-config",
    extension: "settings-ext",
    configScope: "project",
    values: { enabled: true },
  }, project);
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(project, ".pi", "settings.json"), "utf8")), {
    settingsExt: { enabled: true },
  });

  await rm(project, { recursive: true, force: true });
});
