import { silentCommandLaunch } from "./command-launch";
import { preventWindowsGitPrompts, sanitizeProjectCommandEnvironment } from "./project-command-env";

/**
 * The environment of a git child that runs in the user's project folder: the
 * host's without `PORT`, `NODE_ENV`, `NEXT_*` and `PI_WEB_PASSWORD` (ADR 0001),
 * with the message locale pinned to `C`. Git runs hooks the repository's own
 * config names (`core.fsmonitor`) and they inherit this environment.
 */
export function projectGitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return preventWindowsGitPrompts({ ...sanitizeProjectCommandEnvironment(base), LC_ALL: "C" });
}

/** Defaults for direct, noninteractive background Git launches. */
export function projectGitLaunchOptions(base?: NodeJS.ProcessEnv) {
  return { ...silentCommandLaunch, env: projectGitEnvironment(base) };
}
