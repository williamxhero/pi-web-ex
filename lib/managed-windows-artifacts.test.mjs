import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// A deliberately invalid mode must leave earlier evidence intact without starting a server.
test("managed Windows CLI keeps a separate, exclusive log for every run", { timeout: 10_000, skip: process.platform !== "win32" }, async (t) => {
  const output = await mkdtemp(join(tmpdir(), "pi-managed-win-logs-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const legacy = join(output, "managed-browser-server.log");
  await writeFile(legacy, "previous run\n");
  const workspace = join(output, "empty-workspace");
  await mkdir(workspace);
  const run = async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../e2e/managed-windows.mjs", import.meta.url)), "not-a-mode"], {
      cwd: workspace,
      env: { ...process.env, PI_WEB_ACCEPTANCE_OUTPUT: output },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.resume();
    assert.notEqual((await once(child, "close"))[0], 0, "an unknown mode must fail");
    return stdout.match(/^Evidence directory: (.+)$/m)?.[1].trim();
  };
  const first = await run();
  const second = await run();
  assert.equal(await readFile(legacy, "utf8"), "previous run\n");
  assert.ok(first && second && first !== second);
  assert.ok((await readdir(first)).includes("managed-browser-server.log"));
  assert.ok((await readdir(second)).includes("managed-browser-server.log"));
});
