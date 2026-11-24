import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import {
  CONFIG_DIR_NAME,
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
  type ResolvedPaths,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import { cwdAccessRefusal, getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { isPluginSourceCheckable } from "@/lib/plugin-updates";
import {
  findPluginConfigDescriptor,
  PluginConfigError,
  readPluginConfig,
  writePluginConfig,
} from "@/lib/plugin-config";
import { invalidateModelRuntimeWithExtensions } from "@/lib/model-runtime";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginResourceKind,
  PluginScope,
  PluginStandaloneExtensionInfo,
  PluginsBulkResponse,
  PluginsResponse,
  PluginToggleResult,
} from "@/lib/api-types";

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable" | "set-config";

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function toPluginScope(scope: string): PluginScope {
  return scope === "project" ? "project" : "global";
}

function keyFor(source: string, scope: PluginScope): string {
  return `${scope}\0${source}`;
}

function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) && entry.extensions.length === 0 &&
    Array.isArray(entry.skills) && entry.skills.length === 0 &&
    Array.isArray(entry.prompts) && entry.prompts.length === 0 &&
    Array.isArray(entry.themes) && entry.themes.length === 0
  );
}

function getDisabledPackages(settingsManager: SettingsManager): Map<string, boolean> {
  const disabled = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "global"), isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "project"), isDisabledPackage(entry));
  }
  return disabled;
}

/**
 * An enabled entry that is an object: it filters the package's resources, or
 * sets `autoload`. Disabling replaces its resource lists, and Pi Web keeps no
 * copy, so enabling it again cannot bring the filters back.
 */
function hasEntrySettings(entry: PackageSource): boolean {
  return typeof entry === "object" && !isDisabledPackage(entry);
}

const FILTERED_PACKAGE_ERROR =
  "Has resource filters, which disabling would remove; use the package's own switch";

/**
 * Disables or re-enables the given packages of one scope with a single
 * settings write. Returns the sources that scope does not configure, and with
 * `keepEntrySettings` the ones left enabled because disabling would drop
 * their filters.
 *
 * An entry already in the requested state is left exactly as it is, and
 * enabling keeps every key except the emptied resource lists (`autoload` on a
 * project entry, say), so neither drops what the entry configures.
 */
function setPackagesDisabled(
  settingsManager: SettingsManager,
  sources: readonly string[],
  scope: PluginScope,
  disabled: boolean,
  { keepEntrySettings = false }: { keepEntrySettings?: boolean } = {},
): { missing: Set<string>; kept: Set<string> } {
  const current = scope === "project"
    ? settingsManager.getProjectSettings().packages ?? []
    : settingsManager.getGlobalSettings().packages ?? [];
  const missing = new Set(sources);
  const kept = new Set<string>();
  let changed = false;
  const next = current.map((entry): PackageSource => {
    const source = getPackageSource(entry);
    if (!sources.includes(source)) return entry;
    missing.delete(source);
    if (isDisabledPackage(entry) === disabled) return entry;
    if (disabled && keepEntrySettings && hasEntrySettings(entry)) {
      kept.add(source);
      return entry;
    }
    changed = true;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    if (typeof entry === "string") return source;
    const rest = { ...entry };
    delete rest.extensions;
    delete rest.skills;
    delete rest.prompts;
    delete rest.themes;
    return Object.keys(rest).length > 1 ? rest : source;
  });
  if (changed) {
    if (scope === "project") settingsManager.setProjectPackages(next);
    else settingsManager.setPackages(next);
  }
  return { missing, kept };
}

/**
 * The bulk form of enable/disable behind the panel's "Enable all" /
 * "Disable all". Each package gets its own result, so one the route refuses
 * (an untrusted project, a package removed since the panel loaded, a filtered
 * package it would have to strip to disable) does not stop the rest.
 *
 * SettingsManager never throws a failed load or write: it skips the write,
 * records the error, and `flush()` still resolves. Those errors are read back
 * and charged to their scope, or an unreadable settings.json would be reported
 * as a successful toggle.
 */
async function setPackageListDisabled(
  settingsManager: SettingsManager,
  packages: readonly { source: string; scope: PluginScope }[],
  disabled: boolean,
  projectTrusted: boolean,
): Promise<PluginToggleResult[]> {
  const errors = new Map<string, string>();
  for (const scope of ["global", "project"] as const) {
    const sources = packages.filter((pkg) => pkg.scope === scope).map((pkg) => pkg.source);
    if (sources.length === 0) continue;
    if (scope === "project" && !projectTrusted) {
      for (const source of sources) {
        errors.set(keyFor(source, scope), "Project resources must be trusted before modifying project plugins");
      }
      continue;
    }
    // "Disable all" must not wipe filters the operator set up by hand.
    const { missing, kept } = setPackagesDisabled(settingsManager, sources, scope, disabled, {
      keepEntrySettings: true,
    });
    for (const source of missing) errors.set(keyFor(source, scope), "Package is not configured");
    for (const source of kept) errors.set(keyFor(source, scope), FILTERED_PACKAGE_ERROR);
  }
  await settingsManager.flush();
  const settingsErrors = new Map<string, string>();
  for (const { scope, path, error } of settingsManager.drainErrors()) {
    if (!settingsErrors.has(scope)) settingsErrors.set(scope, path ? `${path}: ${error.message}` : error.message);
  }
  return packages.map((pkg) => {
    // A settings file that failed to load also reads as "not configured", so
    // its error wins. An untrusted project is never loaded and records none.
    const error = settingsErrors.get(pkg.scope) ?? errors.get(keyFor(pkg.source, pkg.scope));
    return error ? { ...pkg, error } : { ...pkg };
  });
}

function readPackageList(value: unknown): { source: string; scope: PluginScope }[] | null {
  if (!Array.isArray(value)) return null;
  const packages = new Map<string, { source: string; scope: PluginScope }>();
  for (const item of value) {
    const source = typeof item?.source === "string" ? item.source.trim() : "";
    if (!source) return null;
    const scope = readScope(item.scope);
    packages.set(keyFor(source, scope), { source, scope });
  }
  return [...packages.values()];
}

function addCount(counts: PluginResourceCounts, kind: keyof PluginResourceCounts): void {
  counts[kind] += 1;
}

function getResourceName(path: string, kind: PluginResourceKind): string {
  const file = basename(path);
  const ext = extname(file);
  if (kind === "skill" && file.toLowerCase() === "skill.md") return basename(dirname(path));
  if ((kind === "extension" || kind === "theme" || kind === "prompt") && ext) {
    if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return basename(dirname(path));
    return file.slice(0, -ext.length);
  }
  return file;
}

function getRelativePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  const rel = relative(baseDir, resource.path);
  // Normalize to forward slashes so API output is stable across platforms
  // (Node's path.relative returns backslashes on Windows).
  return rel && !rel.startsWith("..") ? rel.split(sep).join("/") : resource.path;
}

function toResourceInfo(resource: ResolvedResource, kind: PluginResourceKind): PluginResourceInfo {
  return {
    kind,
    name: getResourceName(resource.path, kind),
    path: resource.path,
    relativePath: getRelativePath(resource),
  };
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }

  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string; description?: string } {
  if (!installedPath) return {};
  try {
    const stats = statSync(installedPath);
    const packageJsonPath = stats.isDirectory()
      ? join(installedPath, "package.json")
      : join(dirname(installedPath), "package.json");
    if (!existsSync(packageJsonPath)) return {};
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
      description?: unknown;
    };
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The folder holding an installed package's `package.json`, where a plugin's
 * own settings descriptor lives. A configured entry can point at a directory or
 * at one extension file; the descriptor sits beside the manifest either way.
 */
function packageDirectory(installedPath?: string): string | undefined {
  if (!installedPath) return undefined;
  try {
    return statSync(installedPath).isDirectory() ? installedPath : dirname(installedPath);
  } catch {
    return undefined;
  }
}

/** The descriptors Pi Web ships, beside the app in `plugin-configs/`. */
function bundledPluginConfigDir(): string {
  return join(process.cwd(), "plugin-configs");
}

function collectResource(
  resource: ResolvedResource,
  kind: keyof PluginResourceCounts,
  countsByPackage: Map<string, PluginResourceCounts>,
  resourcesByPackage: Map<string, PluginResourceInfo[]>,
  totals: PluginResourceCounts,
): void {
  if (!resource.enabled || resource.metadata.origin !== "package") return;
  const source = resource.metadata.source;
  const scope = toPluginScope(resource.metadata.scope);
  const key = keyFor(source, scope);
  const counts = countsByPackage.get(key) ?? emptyCounts();
  addCount(counts, kind);
  addCount(totals, kind);
  countsByPackage.set(key, counts);
  const resources = resourcesByPackage.get(key) ?? [];
  const resourceKind = kind === "extensions"
    ? "extension"
    : kind === "skills"
      ? "skill"
      : kind === "prompts"
        ? "prompt"
        : "theme";
  resources.push(toResourceInfo(resource, resourceKind));
  resourcesByPackage.set(key, resources);
}

/**
 * A standalone extension's own descriptor folder: a folder extension keeps
 * `pi.config.json` beside the file pi loads, so the name of the folder has to
 * match the name pi reports for the extension. A single `.ts` file sits
 * directly in `extensions/`, which is a shared folder and not the extension's.
 */
function extensionFolder(path: string, name: string): string | undefined {
  try {
    if (statSync(path).isDirectory()) return path;
  } catch {
    return undefined;
  }
  const folder = dirname(path);
  return basename(folder) === name ? folder : undefined;
}

function collectResources(
  paths: ResolvedPaths,
  context: { agentDir: string; cwd: string; diagnostics: PluginDiagnostic[] },
): {
  countsByPackage: Map<string, PluginResourceCounts>;
  resourcesByPackage: Map<string, PluginResourceInfo[]>;
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
} {
  const countsByPackage = new Map<string, PluginResourceCounts>();
  const resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  const totals = emptyCounts();
  for (const resource of paths.extensions) collectResource(resource, "extensions", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.skills) collectResource(resource, "skills", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.prompts) collectResource(resource, "prompts", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.themes) collectResource(resource, "themes", countsByPackage, resourcesByPackage, totals);
  const standaloneExtensions = paths.extensions
    .filter((resource) => resource.metadata.origin === "top-level")
    .map((resource): PluginStandaloneExtensionInfo => {
      const info = toResourceInfo(resource, "extension");
      // Same descriptor mechanism as a package, keyed by the name pi reports:
      // the extension's own folder, then the user's copy, then the shipped one.
      const found = findPluginConfigDescriptor({
        name: info.name,
        packageDir: extensionFolder(info.path, info.name),
        agentDir: context.agentDir,
        bundledDir: bundledPluginConfigDir(),
      });
      if (found.error) {
        context.diagnostics.push({ type: "warning", source: info.name, message: found.error });
      }
      return {
        ...info,
        kind: "extension",
        scope: toPluginScope(resource.metadata.scope),
        enabled: resource.enabled,
        ...(found.descriptor && found.origin
          ? {
            config: readPluginConfig(
              found.descriptor,
              { agentDir: context.agentDir, cwd: context.cwd, configDir: CONFIG_DIR_NAME },
              found.origin,
            ),
          }
          : {}),
      };
    });
  totals.extensions += standaloneExtensions.filter((extension) => extension.enabled).length;
  return { countsByPackage, resourcesByPackage, standaloneExtensions, totals };
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  const diagnostics: PluginDiagnostic[] = [];
  let countsByPackage = new Map<string, PluginResourceCounts>();
  let resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  let standaloneExtensions: PluginStandaloneExtensionInfo[] = [];
  let totals = emptyCounts();
  const disabledByPackage = getDisabledPackages(settingsManager);

  try {
    const resolved = await packageManager.resolve(async (source) => {
      diagnostics.push({
        type: "warning",
        source,
        message: "Package is configured but not installed yet.",
      });
      return "skip";
    });
    ({ countsByPackage, resourcesByPackage, standaloneExtensions, totals } = collectResources(resolved, {
      agentDir,
      cwd,
      diagnostics,
    }));
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const packages = packageManager.listConfiguredPackages().map((pkg) => {
    const scope = toPluginScope(pkg.scope);
    const key = keyFor(pkg.source, scope);
    const disabled = disabledByPackage.get(key) ?? false;
    const counts = countsByPackage.get(key) ?? emptyCounts();
    const resources = resourcesByPackage.get(key) ?? [];
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    const packageMetadata = readPackageMetadata(pkg.installedPath);
    // Only a plugin Pi Web has a descriptor for gets a form: its own
    // `pi.config.json`, the user's copy, or the one shipped here.
    const descriptor = findPluginConfigDescriptor({
      source: pkg.source,
      packageDir: packageDirectory(pkg.installedPath),
      agentDir,
      bundledDir: bundledPluginConfigDir(),
    });
    if (descriptor.error) {
      diagnostics.push({ type: "warning", source: pkg.source, message: descriptor.error });
    }
    if (!pkg.installedPath) {
      diagnostics.push({
        type: "warning",
        source: pkg.source,
        message: "Configured package path was not found.",
      });
    }
    return {
      source: pkg.source,
      scope,
      canCheckForUpdates: isPluginSourceCheckable(pkg.source),
      filtered: pkg.filtered,
      disabled,
      installedPath: pkg.installedPath,
      packageName: packageMetadata.packageName,
      version: packageMetadata.version,
      configuredVersion: getConfiguredVersion(pkg.source),
      description: packageMetadata.description,
      counts,
      resources,
      status: disabled ? "disabled" : resourceCount > 0 ? "loaded" : pkg.installedPath ? "installed" : "missing",
      // The route reads both layers, the project one refining the user one, so
      // a key the project leaves alone shows the value the plugin will use.
      config: descriptor.descriptor && descriptor.origin
        ? readPluginConfig(
          descriptor.descriptor,
          { agentDir, cwd, configDir: CONFIG_DIR_NAME },
          descriptor.origin,
        )
        : undefined,
    } satisfies PluginPackageInfo;
  });

  return {
    packages,
    standaloneExtensions,
    totals,
    diagnostics,
    projectResourcesLoaded: projectTrust.trusted,
  };
}

function readScope(scope: unknown): PluginScope {
  return scope === "project" ? "project" : "global";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") ?? "";

  try {
    const refused = await cwdAccessRefusal(cwd);
    if (refused) return refused;
    return NextResponse.json(await readPlugins(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * A plugin's settings, written by the Plugins detail pane's form. The keys come
 * from the descriptor the panel rendered, so a stale page cannot write a key
 * the plugin would ignore; the route resolves the descriptor itself rather than
 * trusting the page's copy. `source` names a package and `extension` a
 * standalone extension; exactly one of them is given.
 */
async function setPluginConfig(
  body: {
    source?: string;
    extension?: string;
    configScope?: unknown;
    values?: unknown;
    remove?: unknown;
    cwd: string;
  },
  context: {
    agentDir: string;
    projectTrusted: boolean;
    /** The package folder, or the folder a folder extension lives in. */
    packageDir?: string;
  },
): Promise<Response> {
  const source = body.source?.trim();
  const extension = body.extension?.trim();
  if ((source ? 1 : 0) + (extension ? 1 : 0) !== 1) {
    return NextResponse.json(
      { error: "Give exactly one of source (a package) or extension (a standalone extension)" },
      { status: 400 },
    );
  }
  const configScope = readScope(body.configScope);
  if (configScope === "project" && !context.projectTrusted) {
    return NextResponse.json(
      { error: "Project resources must be trusted before writing project config" },
      { status: 403 },
    );
  }
  const found = findPluginConfigDescriptor({
    ...(source ? { source } : {}),
    ...(extension ? { name: extension } : {}),
    packageDir: context.packageDir,
    agentDir: context.agentDir,
    bundledDir: bundledPluginConfigDir(),
  });
  if (found.error) return NextResponse.json({ error: found.error }, { status: 400 });
  if (!found.descriptor) {
    return NextResponse.json(
      { error: `No settings descriptor is known for ${source ?? extension}` },
      { status: 400 },
    );
  }
  if (!found.descriptor.storage.locations.includes(configScope)) {
    return NextResponse.json(
      { error: `This plugin does not read the ${configScope} layer` },
      { status: 400 },
    );
  }
  try {
    await writePluginConfig(
      found.descriptor,
      { agentDir: context.agentDir, cwd: body.cwd, configDir: CONFIG_DIR_NAME },
      configScope,
      { values: body.values, remove: body.remove },
    );
  } catch (error) {
    if (error instanceof PluginConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  return NextResponse.json(await readPlugins(body.cwd));
}

/** Where a folder extension named `name` sits, in either extension root. */
function extensionDirectory(name: string, cwd: string, agentDir: string): string | undefined {
  for (const dir of [join(agentDir, "extensions", name), join(cwd, CONFIG_DIR_NAME, "extensions", name)]) {
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {
      // Not there: try the next root.
    }
  }
  return undefined;
}

// POST /api/plugins body: { action, source?, scope?, cwd }
// enable/disable also take { packages: [{ source, scope }] } in place of
// source/scope and add per-package `results` to the response.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: PluginAction;
      source?: string;
      extension?: string;
      scope?: PluginScope;
      packages?: unknown;
      configScope?: unknown;
      values?: unknown;
      remove?: unknown;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const projectTrust = getProjectTrustStatus(body.cwd, agentDir);
    const settingsManager = SettingsManager.create(body.cwd, agentDir, {
      projectTrusted: projectTrust.trusted,
    });

    // A settings entry belongs to its plugin, not to the package list, so it is
    // written before the package-scope gate below: a global package can be
    // configured for one project.
    if (body.action === "set-config") {
      const cwd = body.cwd;
      const packageScope = readScope(body.scope);
      const configured = new DefaultPackageManager({ cwd, agentDir, settingsManager }).listConfiguredPackages();
      const entry = body.source
        ? configured.find((pkg) => pkg.source === body.source && toPluginScope(pkg.scope) === packageScope)
          ?? configured.find((pkg) => pkg.source === body.source)
        : undefined;
      const extension = body.extension?.trim();
      return await setPluginConfig({ ...body, cwd }, {
        agentDir,
        projectTrusted: projectTrust.trusted,
        packageDir: extension
          ? extensionDirectory(extension, cwd, agentDir)
          : packageDirectory(entry?.installedPath),
      });
    }

    if (body.packages !== undefined) {
      if (body.action !== "enable" && body.action !== "disable") {
        return NextResponse.json({ error: "packages is only supported by enable and disable" }, { status: 400 });
      }
      const packages = readPackageList(body.packages);
      if (!packages) {
        return NextResponse.json({ error: "packages must be a list of { source, scope }" }, { status: 400 });
      }
      const results = await setPackageListDisabled(
        settingsManager,
        packages,
        body.action === "disable",
        projectTrust.trusted,
      );
      return NextResponse.json({ ...(await readPlugins(body.cwd)), results } satisfies PluginsBulkResponse);
    }

    const scope = readScope(body.scope);
    if (scope === "project" && !projectTrust.trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before modifying project plugins" },
        { status: 403 },
      );
    }
    const packageManager = new DefaultPackageManager({
      cwd: body.cwd,
      agentDir,
      settingsManager,
    });
    const source = body.source?.trim();
    const local = scope === "project";

    if (body.action === "install") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.installAndPersist(source, { local });
    } else if (body.action === "remove") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      await packageManager.removeAndPersist(source, { local });
    } else if (body.action === "update") {
      if (!source && !projectTrust.trusted && packageManager.listConfiguredPackages().some((pkg) => pkg.scope === "project")) {
        return NextResponse.json(
          { error: "Project resources must be trusted before updating project plugins" },
          { status: 403 },
        );
      }
      await packageManager.update(source);
    } else if (body.action === "disable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackagesDisabled(settingsManager, [source], scope, true);
      await settingsManager.flush();
    } else if (body.action === "enable") {
      if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
      setPackagesDisabled(settingsManager, [source], scope, false);
      await settingsManager.flush();
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readPlugins(body.cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    // The provider lists share one extension-loaded runtime, and a package can
    // add or drop a provider; an update that failed halfway may have, too. An
    // in-place update keeps the package's path, so its new code shows after
    // /reload, or once a session start in a project has moved the SDK's
    // extension factory cache, when the runtime is next built (at the latest
    // when it expires).
    invalidateModelRuntimeWithExtensions();
  }
}
