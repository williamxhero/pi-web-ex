import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ex from "../bin/ex-product.js";
import update from "../bin/pi-web-update.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? "dist-release");
const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (source.name !== ex.EX_PACKAGE) throw new Error("Wrong package name for Ex release");
if (!existsSync(join(root, ".next", "BUILD_ID"))) throw new Error("Build the production app before packaging");
if (existsSync(join(root, ".next", "turbopack"))) {
  throw new Error("Build with npm run build (webpack); Turbopack externals are not portable in a tarball");
}
const stage = mkdtempSync(join(tmpdir(), "pi-web-ex-pack-"));
try {
  for (const entry of ["bin", "plugin-configs", "public", ".next", "next.config.ts", "fork-version.json", "README.md", "LICENSE"]) {
    cpSync(join(root, entry), join(stage, entry), { recursive: true, filter: (file) => !file.endsWith(".map") && file !== join(root, ".next", "cache") && file !== join(root, ".next", "dev") });
  }
  const manifest = { ...source, upstreamVersion: ex.UPSTREAM_VERSION, version: ex.APP_VERSION };
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  mkdirSync(output, { recursive: true });
  const pack = update.findNpmInvocation(["pack", "--ignore-scripts", "--json", "--pack-destination", stage]);
  if (!pack) throw new Error("Could not locate npm's CLI");
  const result = spawnSync(pack.command, pack.args, { cwd: stage, windowsHide: true, shell: false, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw result.error ?? new Error(result.stderr || "npm pack failed");
  const [archive] = JSON.parse(result.stdout);
  if (archive.version !== ex.APP_VERSION || archive.name !== ex.EX_PACKAGE) throw new Error("Unexpected npm pack metadata");
  const required = [".next/BUILD_ID", "bin/pi-web.js", "bin/ex-product.js", "fork-version.json", "public/icons/icon-192.png"];
  for (const file of required) {
    if (!archive.files.some((entry) => entry.path === file)) throw new Error("Missing packed file: " + file);
  }
  const destination = join(output, ex.RELEASE_ASSET_NAME);
  // Output may be on a different volume than the staging directory.
  const temporary = destination + "." + process.pid + ".tmp";
  try {
    cpSync(join(stage, archive.filename), temporary, { errorOnExist: true, force: false });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log(destination);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
