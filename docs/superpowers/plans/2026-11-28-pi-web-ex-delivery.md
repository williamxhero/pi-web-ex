# Pi Web Ex Delivery Implementation Plan

> **For agentic workers:** use Superpowers subagent-driven development for disjoint tasks and independent review, or executing-plans for inline integration. Verify before promotion.

**Goal:** Ship Pi Web Ex branding, two-part versions, and an Ex-only update path; deploy the verified build and push fork main.

**Architecture:** Source package version tracks upstream; tracked `fork-version.json` stores the fork version, with a CommonJS bridge packaged under `bin/` for CLI, Next, and release tooling. A single Ex GitHub Releases client validates name, tag and asset. App and demo share presentation rules.

**Tech Stack:** Next.js, React, Node.js CLI/test runner, npm, GitHub Actions, GHCR.

**Spec:** [Pi Web Ex design](../specs/2026-11-28-pi-web-ex-brand-release-design.md)

## Global Constraints

- Ex repository `williamxhero/pi-web-ex`; no upstream release fallback; automatic checks never install.
- Display `0.19.0+1.0.0`; compact brand `πx`; keep `pi-web`, env variables and user data compatible.
- Use the existing isolated merge worktree at `edbc02b` as the candidate; do not build or install in the live source checkout.
- No release tag, public GitHub Release, or public image publication during this delivery. Push only verified fork `main`.

## Tasks

- [ ] **Version and updater:** expose `bin/ex-product.js` exports `PRODUCT_NAME`, `EX_REPOSITORY`, `RELEASE_ASSET_NAME`, `APP_VERSION`, `UPSTREAM_VERSION`, `FORK_VERSION`, `CONTAINER_VERSION`, and `isNewerExVersion`. Share validated Ex release data across `app/api/app-update/route.ts` and CLI; handle offline/missing asset/malformed/older releases. Exercise a later fork version, earlier upstream version, unexpected asset URL, no release, and blocked install during running server; check before/after.
- [ ] **Browser/demo text, metadata and sidebar:** show full title when it fits, `πx` otherwise, and reveal full version plus SDK in a non-layout-changing, keyboard-dismissable card. Set `NEXT_PUBLIC_APP_VERSION` in main and demo from `APP_VERSION`. Check 180 px and normal width, Escape, touch, PWA override, locale text and `πx` accessibility. CLI/help stays in updater task.
- [ ] **Icon outputs:** overlay an Ex mark on original π icons, keep offline/notification/PWA assets in sync with demo, generate ICO with legible tiny output and an optional README badge. Confirm image dimensions and visually review small and large sizes; retain original attribution.
- [ ] **Distribution/docs:** stage a packed npm tarball with combined package manifest version and explicit `upstreamVersion` field; package name is `@williamxhero/pi-web-ex`, fixed asset is `pi-web-ex.tgz`. Fork-only workflow uses exact combined tag and Docker-safe `0.19.0-ex.1.0.0`; publish complete artifacts before making a draft visible. Rewrite root README following CPA layout and direct product links to Ex, keep attribution/upstream archive separate. Test release contract and inspect the staged manifest.
- [ ] **Review/integrate:** independently review candidate; run affected checks, TypeScript/lint; run one broad suite if justified by version/package/locale/launcher boundaries. Build in isolation. Fresh Playwright checks for width and version; smoke packaged deployment. Reuse previous merge tests for unaffected files.
- [ ] **Deliver:** identify the exact live server and rollback path, preserve the existing agent data/environment, deploy verified candidate and smoke the new instance before retiring old. Fast-forward local main only from the verified base, push only to `fork` and compare SHAs, update README first then GitHub About top three and read back. Record local deployment process/build ID and what was not published.
