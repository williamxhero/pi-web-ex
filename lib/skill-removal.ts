import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import type { SkillInfo } from "@/lib/api-types";
import { getGlobalSkillsLockPath } from "./skill-lock";

export interface SkillRemovalOptions {
  cwd: string;
  agentDir: string;
  /** The home folder holding the shared `.agents/skills` root. */
  homeDir?: string;
  /** The skills lock a global skill's entry lives in; defaults to `getGlobalSkillsLockPath()`. */
  globalLockPath?: string;
  /** The `skills-lock.json` a project skill's entry lives in; defaults to `<cwd>/skills-lock.json`. */
  projectLockPath?: string;
}

export type SkillRemovalResult =
  | { ok: true; removed: string[] }
  | { ok: false; status: number; error: string };

interface SkillRoot {
  path: string;
  global: boolean;
}

/** True when `target` sits below `root`, not on it: deleting a root would delete every skill. */
function isStrictlyWithin(target: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function findGitRepoRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * A project's `.agents/skills` folders, as pi loads them: from the folder up
 * to the git repository root, or every ancestor when it is not in a repository.
 */
function projectAgentsSkillDirs(startDir: string): string[] {
  const dirs: string[] = [];
  const repoRoot = findGitRepoRoot(startDir);
  let dir = resolve(startDir);
  while (true) {
    dirs.push(join(dir, ".agents", "skills"));
    if (repoRoot && dir === repoRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** Every folder pi lists skills from for `cwd`, with the lock file its entries belong to. */
export function skillRoots(
  cwd: string,
  agentDir: string,
  homeDir = homedir(),
): SkillRoot[] {
  const roots: SkillRoot[] = [
    { path: join(agentDir, "skills"), global: true },
    { path: join(homeDir, ".agents", "skills"), global: true },
    { path: join(cwd, ".pi", "skills"), global: false },
  ];
  for (const dir of projectAgentsSkillDirs(cwd)) roots.push({ path: dir, global: false });

  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = resolve(root.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function realRootPaths(roots: SkillRoot[]): string[] {
  const reals: string[] = [];
  for (const root of roots) {
    try {
      reals.push(realpathSync(root.path));
    } catch {
      // A folder that does not exist holds no skill.
    }
  }
  return reals;
}

/**
 * Whether a link's real folder is a skill copy in a *different* skills folder
 * than the link's. A link to another folder of its own root is an alias, and
 * that folder may be a skill of its own, so only the link goes.
 */
function isOtherRootSkillCopy(realFolder: string, linkRoot: string, realRoots: string[]): boolean {
  let ownRoot: string | null = null;
  try {
    ownRoot = realpathSync(linkRoot);
  } catch {
    // The link's folder is gone; treat the target as a copy in another root.
  }
  return realRoots.some((root) => root !== ownRoot && isStrictlyWithin(realFolder, root));
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Direct children of the skills folders that are links to one of the removed
 * paths: an install symlinked into several agent folders leaves them behind
 * otherwise. Links outside the skills folders are never touched.
 */
function linksTo(paths: Set<string>, roots: SkillRoot[]): string[] {
  const links: string[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const path = join(root.path, entry.name);
      if (paths.has(resolve(path))) continue;
      try {
        if (paths.has(realpathSync(path))) links.push(path);
      } catch {
        // A dangling link points at nothing to remove.
      }
    }
  }
  return links;
}

/**
 * Drops `name` from a skills lock file if it is there. A lock that is not JSON
 * is left alone, so a hand-edited file is never replaced by a parsed guess.
 */
function removeLockEntry(lockPath: string, name: string): void {
  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return;
  }
  if (typeof lock !== "object" || lock === null) return;
  const skills = (lock as { skills?: unknown }).skills;
  if (typeof skills !== "object" || skills === null) return;

  const entries = skills as Record<string, unknown>;
  const key = Object.keys(entries).find((entry) => entry === name)
    ?? Object.keys(entries).find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (key === undefined) return;
  delete entries[key];
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

/**
 * Deletes one skill from the folder pi listed it in.
 *
 * Only files and folders under `skillRoots()` are touched, so a skill from a
 * package, a settings `skills` path or a plugin folder is refused instead of
 * deleting part of someone else's directory. A skill folder that is a link
 * (a skills CLI install symlinked into `~/.pi/agent/skills`, or a user's
 * shared checkout) has only the link removed unless the link points into
 * another skills folder: then the copy pi would list next is removed too, or
 * the skill would stay in the panel under its real path. The real target of a
 * link outside those folders is never touched.
 */
export function removeSkillFiles(
  skill: Pick<SkillInfo, "filePath" | "name">,
  options: SkillRemovalOptions,
): SkillRemovalResult {
  const homeDir = options.homeDir ?? homedir();
  const roots = skillRoots(options.cwd, options.agentDir, homeDir);
  const filePath = resolve(skill.filePath);
  const root = roots.find((item) => isStrictlyWithin(filePath, item.path));
  if (!root) {
    return {
      ok: false,
      status: 403,
      error: "This skill is not stored in a skills folder, so it cannot be deleted here.",
    };
  }

  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch {
    return { ok: false, status: 404, error: "The skill file no longer exists." };
  }

  const primary: string[] = [];
  if (basename(filePath).toLowerCase() === "skill.md") {
    const folder = dirname(filePath);
    if (roots.some((item) => resolve(item.path) === folder)) {
      return { ok: false, status: 403, error: "Refusing to delete a skills folder itself." };
    }
    if (isSymbolicLink(folder)) {
      const realFolder = dirname(realFilePath);
      // The copy pi would read next, but only when it is a managed skill copy.
      if (resolve(realFolder) !== folder && isOtherRootSkillCopy(realFolder, root.path, realRootPaths(roots))) {
        primary.push(realFolder);
      }
      primary.push(folder);
    } else {
      primary.push(folder);
    }
  } else {
    primary.push(filePath);
  }

  // Plan before deleting: link cleanup needs the targets still resolvable.
  const planned = new Set(primary.map((path) => resolve(path)));
  const realPlanned = new Set<string>();
  for (const path of planned) {
    try {
      realPlanned.add(realpathSync(path));
    } catch {
      // The primary path itself is missing; rm below reports it.
    }
  }
  const links = linksTo(realPlanned, roots);

  const removed: string[] = [];
  for (const [index, path] of [...primary, ...links].entries()) {
    try {
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      // The primary path is the skill itself; a leftover link is only tidying.
      if (index === 0) {
        return {
          ok: false,
          status: 500,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const lockPath = root.global
    ? options.globalLockPath ?? getGlobalSkillsLockPath({ homeDir })
    : options.projectLockPath ?? join(options.cwd, "skills-lock.json");
  try {
    removeLockEntry(lockPath, skill.name);
  } catch {
    // The skill is gone; a lock file that cannot be written only leaves a
    // stale entry that no skill file matches anymore.
  }

  return { ok: true, removed };
}
