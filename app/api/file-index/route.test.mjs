import assert from "node:assert/strict";
import { ChildProcess, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

test("@ file index runs Git without opening a console", { skip: process.platform !== "win32" }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-file-index-")));
  const cwd = join(base, "repo");
  const agentDir = join(base, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  const previousCache = globalThis.__piAllowedRootsCache;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete globalThis.__piAdditionalAllowedRoots;
  delete globalThis.__piAllowedRootsCache;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    globalThis.__piAdditionalAllowedRoots = previousRoots;
    globalThis.__piAllowedRootsCache = previousCache;
    globalThis.__piFileIndexCache?.delete(cwd);
    rmSync(base, { force: true, recursive: true });
  });
  execFileSync("git", ["-C", cwd, "init", "--quiet"], { windowsHide: true });
  writeFileSync(join(cwd, "visible.txt"), "fixture");
  allowFileRoot(cwd);
  const spawn = t.mock.method(ChildProcess.prototype, "spawn");
  const url = new URL("http://localhost/api/file-index");
  url.searchParams.set("cwd", cwd);
  const response = await GET(new NextRequest(url));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { files: ["visible.txt"], truncated: false });
  assert.deepEqual(spawn.mock.calls.map(({ arguments: [options] }) => [options.file, options.windowsHide]), [["git", true]]);
});
