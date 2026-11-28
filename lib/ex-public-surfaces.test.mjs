import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ex from "../bin/ex-product.js";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function demoProduct(t) {
  const { default: config } = await import("../demo/next.config.ts");
  for (const key of ["NEXT_PUBLIC_EX_REPO_URL", "NEXT_PUBLIC_EX_VERSION", "NEXT_PUBLIC_EX_RELEASE_URL"]) {
    const value = process.env[key];
    process.env[key] = config.env[key];
    t.after(() => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
  return createJiti(import.meta.url, { moduleCache: false }).import("../demo/mock/product.ts");
}

test("demo install directions are executable Ex source commands rather than an upstream npm package", async (t) => {
  const { DEMO_INSTALL_COMMAND, DEMO_INSTALL_GUIDE } = await demoProduct(t);
  assert.match(DEMO_INSTALL_COMMAND, /^git clone https:\/\/github\.com\/williamxhero\/pi-web-ex\.git\ncd pi-web-ex\nnpm ci\nnpm run dev$/);
  assert.equal(DEMO_INSTALL_GUIDE, ex.REPO_URL + "#readme");
  const welcome = await source("demo/mock/sessions/content/welcome.ts");
  assert.equal(welcome.match(/\$\{DEMO_INSTALL_COMMAND\.replaceAll\(/g)?.length, 2, "both language variants show the Ex command");
  assert.doesNotMatch(welcome, /@agegr\/pi-web/);
});

test("demo update metadata still uses the actual Ex version if the shared runtime value is absent", async (t) => {
  const { demoAppUpdate } = await demoProduct(t);
  for (const runtimeVersion of [undefined, "0.0.0", "bad", ex.APP_VERSION]) {
    const status = demoAppUpdate(runtimeVersion);
    assert.deepEqual(status, {
      currentVersion: ex.APP_VERSION, latestVersion: ex.APP_VERSION,
      updateAvailable: false, releaseUrl: ex.exReleaseUrl(ex.APP_VERSION),
    });
  }
});

test("MCP messages and install docs have no first-party upstream-brand entry points", async () => {
  for (const path of [
    "app/api/mcp/route.ts", "app/api/mcp/sign-in/[flowId]/route.ts", "lib/mcp-add.ts",
    "lib/mcp-config-read.ts", "lib/mcp-entry-request.ts", "lib/mcp-host.ts", "lib/mcp-sign-in.ts",
    "lib/mcp-transport.ts", "lib/pi-sdk-internals.ts",
    "demo/mock/export.ts", "demo/mock/replies.ts", "demo/mock/sessions/content/extend.ts",
    "demo/mock/sessions/content/models.ts", "demo/mock/sessions/content/scratch.ts", "demo/mock/sessions/content/tips.ts",
  ]) {
    const sourceText = (await source(path)).split("\n").filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join("\n");
    assert.equal(sourceText.match(/\bPi Web\b(?! Ex\b)/)?.[0], undefined, path);
  }
  const docker = await source("docs/docker.md");
  assert.doesNotMatch(docker, /ghcr\.io\/agegr\/pi-web/);
  assert.ok(docker.includes(`ghcr.io/${ex.EX_REPOSITORY}:${ex.CONTAINER_VERSION}`));
});
