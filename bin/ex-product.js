"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifest = require("../package.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: FORK_VERSION } = require("../fork-version.json");

const PRODUCT_NAME = "Pi Web Ex";
const EX_REPOSITORY = "williamxhero/pi-web-ex";
const EX_PACKAGE = "@williamxhero/pi-web-ex";
const RELEASE_ASSET_NAME = "pi-web-ex.tgz";
const UPSTREAM_VERSION = manifest.upstreamVersion ?? manifest.version;
const APP_VERSION = UPSTREAM_VERSION + "+" + FORK_VERSION;
const CONTAINER_VERSION = UPSTREAM_VERSION + "-ex." + FORK_VERSION;
const REPO_URL = "https://github.com/" + EX_REPOSITORY;
const RELEASES_URL = REPO_URL + "/releases";

function parseExVersion(version) {
  if (typeof version !== "string") return null;
  const number = "(0|[1-9][0-9]*)";
  const triplet = [number, number, number].join("\\.");
  const match = new RegExp("^" + triplet + "\\+" + triplet + "$").exec(version);
  if (!match || match[0] !== version) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewerExVersion(candidate, current) {
  const next = parseExVersion(candidate);
  const installed = parseExVersion(current);
  if (!next || !installed) return false;
  const index = next.findIndex((value, i) => value !== installed[i]);
  return index !== -1 && next[index] > installed[index];
}

function exReleaseUrl(version) {
  return parseExVersion(version) ? RELEASES_URL + "/tag/" + encodeURIComponent("v" + version) : null;
}

async function fetchLatestExRelease(request = fetch, timeoutMs = 5000) {
  const response = await request("https://api.github.com/repos/" + EX_REPOSITORY + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Ex Release check returned HTTP " + response.status);
  const body = await response.json();
  const tag = body?.tag_name;
  const version = typeof tag === "string" && tag.startsWith("v") ? tag.slice(1) : null;
  const url = exReleaseUrl(version);
  if (!url || body.draft !== false || body.prerelease !== false || !Array.isArray(body.assets)) {
    throw new Error("Invalid Pi Web Ex release data");
  }
  const asset = body.assets.some((entry) => entry?.name === RELEASE_ASSET_NAME && entry.state === "uploaded");
  const assetUrl = asset ? RELEASES_URL + "/download/" + encodeURIComponent(tag) + "/" + RELEASE_ASSET_NAME : null;
  return { version, url, assetUrl };
}

if (!parseExVersion(APP_VERSION)) throw new Error("Invalid Pi Web Ex product version: " + APP_VERSION);

module.exports = {
  PRODUCT_NAME, EX_REPOSITORY, EX_PACKAGE, RELEASE_ASSET_NAME, UPSTREAM_VERSION, FORK_VERSION,
  APP_VERSION, CONTAINER_VERSION, REPO_URL, RELEASES_URL, isNewerExVersion, exReleaseUrl, fetchLatestExRelease,
};
