import { APP_VERSION, fetchLatestExRelease, isNewerExVersion } from "../bin/ex-product";
import type { AppUpdateResponse } from "./api-types";

export function noAppUpdate(): AppUpdateResponse {
  return { currentVersion: APP_VERSION, latestVersion: APP_VERSION, updateAvailable: false, releaseUrl: "" };
}

export async function getAppUpdate(request?: typeof fetch): Promise<AppUpdateResponse> {
  const release = await fetchLatestExRelease(request);
  if (!release) return noAppUpdate();
  return {
    currentVersion: APP_VERSION,
    latestVersion: release.version,
    updateAvailable: Boolean(release.assetUrl) && isNewerExVersion(release.version, APP_VERSION),
    releaseUrl: release.url,
  };
}
