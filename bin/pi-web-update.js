"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync, spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EX_PACKAGE, RELEASES_URL, fetchLatestExRelease, isNewerExVersion } = require("./ex-product");

// npm's own CLI script run through this node, so no shell is needed on
// Windows (same lookup as lib/node-cli.ts). null: no way to run npm safely.
function findNpmInvocation(args, nodeDir = path.dirname(process.execPath), platform = process.platform, exists = fs.existsSync) {
  for (const script of [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]) {
    if (exists(script)) return { command: process.execPath, args: [script, ...args] };
  }
  return platform === "win32" ? null : { command: "npm", args };
}

function realpathOrSelf(target, realpath = fs.realpathSync) {
  try {
    return realpath(target);
  } catch {
    return path.resolve(target);
  }
}

// "global": pkgDir is the Ex package under npm's global root; "npx": a cache.
function getInstallKind({ pkgDir, npmRoot, realpath = fs.realpathSync }) {
  const realPkgDir = realpathOrSelf(pkgDir, realpath);
  if (realPkgDir.split(/[\\/]/).includes("_npx")) return "npx";
  if (!npmRoot) return "other";
  const [scope, name] = EX_PACKAGE.split("/");
  const inGlobalRoot =
    path.basename(realPkgDir) === name &&
    path.basename(path.dirname(realPkgDir)) === scope &&
    realpathOrSelf(path.dirname(path.dirname(realPkgDir)), realpath) === realpathOrSelf(npmRoot, realpath);
  return inGlobalRoot ? "global" : "other";
}

function getGlobalNpmRoot() {
  const invocation = findNpmInvocation(["root", "-g"]);
  if (!invocation) return null;
  try {
    return execFileSync(invocation.command, invocation.args, { encoding: "utf8", timeout: 30_000, windowsHide: true, shell: false }).trim();
  } catch {
    return null;
  }
}

function runNpmInstall(assetUrl) {
  const invocation = findNpmInvocation(["install", "-g", assetUrl]);
  if (!invocation) return null;
  const result = spawnSync(invocation.command, invocation.args, { stdio: "inherit", windowsHide: true, shell: false });
  return result.status ?? 1;
}

async function runUpdate({
  check,
  currentVersion,
  pkgDir,
  listRecords,
  formatRecord,
  fetchLatest = fetchLatestExRelease,
  getNpmRoot = getGlobalNpmRoot,
  install = runNpmInstall,
  realpath = fs.realpathSync,
  log = console.log,
  error = console.error,
}) {
  let latest;
  try {
    latest = await fetchLatest();
  } catch (fetchError) {
    error(`Could not check for updates: ${fetchError.message}`);
    return 1;
  }
  if (!latest) {
    log("No stable Pi Web Ex release has been published yet.");
    return check ? 0 : 1;
  }
  if (!latest.assetUrl) {
    error(`Pi Web Ex release ${latest.version} has no installable asset: ${latest.url}`);
    return 1;
  }
  if (!isNewerExVersion(latest.version, currentVersion)) {
    log(`Pi Web Ex ${currentVersion} is up to date.`);
    return 0;
  }
  log(`Pi Web Ex ${latest.version} is available (installed: ${currentVersion}).`);
  if (check) return 0;

  // A running `next start` has .next/ open; never replace it underneath.
  const running = await listRecords();
  if (running.length > 0) {
    error(`pi-web is running:\n${running.map(formatRecord).join("\n")}\nRun \`pi-web stop\` first, then update.`);
    return 1;
  }

  const kind = getInstallKind({ pkgDir, npmRoot: getNpmRoot(), realpath });
  const manualCommand = `npm install -g "${latest.assetUrl}"`;
  if (kind !== "global") {
    error(`This is not a global npm install of Pi Web Ex. See ${RELEASES_URL}, or install explicitly: ${manualCommand}`);
    return 1;
  }

  const code = install(latest.assetUrl);
  if (code === null) {
    error(`Could not find npm. Run: ${manualCommand}`);
    return 1;
  }
  return code;
}

module.exports = { findNpmInvocation, getInstallKind, runUpdate };
