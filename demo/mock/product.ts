const repoUrl = process.env.NEXT_PUBLIC_EX_REPO_URL!;
const packagedVersion = process.env.NEXT_PUBLIC_EX_VERSION!;
const packagedReleaseUrl = process.env.NEXT_PUBLIC_EX_RELEASE_URL!;

export const DEMO_INSTALL_GUIDE = repoUrl + "#readme";
export const DEMO_INSTALL_COMMAND = [
  "git clone " + repoUrl + ".git",
  "cd " + repoUrl.split("/").at(-1),
  "npm ci",
  "npm run dev",
].join("\n");

export function demoAppUpdate(runtimeVersion = process.env.NEXT_PUBLIC_APP_VERSION) {
  const version = runtimeVersion && /^\d+\.\d+\.\d+\+\d+\.\d+\.\d+$/.test(runtimeVersion)
    ? runtimeVersion : packagedVersion;
  return {
    currentVersion: version,
    latestVersion: version,
    updateAvailable: false,
    releaseUrl: version === packagedVersion ? packagedReleaseUrl : repoUrl + "/releases/tag/" + encodeURIComponent("v" + version),
  };
}
