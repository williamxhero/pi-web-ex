import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cli = readFileSync(new URL("../bin/pi-web.js", import.meta.url), "utf8");

test("the installed CLI starts its Next subprocess without a console or shell", () => {
  const launch = cli.slice(cli.indexOf("const child = spawn("), cli.indexOf("wireChildProcessLifecycle(child);"));
  assert.match(launch, /windowsHide: true/);
  assert.match(launch, /shell: false/);
});
