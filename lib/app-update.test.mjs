import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import ex from "../bin/ex-product.js";

const { getAppUpdate, noAppUpdate } = await createJiti(import.meta.url).import("./app-update.ts");
const latest = "0.19.0+1.0.1";
const release = (asset) => async () => Response.json({ tag_name: "v" + latest, draft: false, prerelease: false, assets: asset ? [{ name: "pi-web-ex.tgz", state: "uploaded" }] : [] });

test("automatic checks advertise a valid new Ex release but never install it", async () => {
  assert.deepEqual(await getAppUpdate(release(true)), {
    currentVersion: ex.APP_VERSION, latestVersion: latest, updateAvailable: true, releaseUrl: ex.exReleaseUrl(latest),
  });
  assert.equal((await getAppUpdate(release(false))).updateAvailable, false);
  assert.deepEqual(await getAppUpdate(async () => Response.json({}, { status: 404 })), noAppUpdate());
});
