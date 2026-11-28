import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PiWebTitle } = await jiti.import("./PiWebTitle.tsx");

test("the sidebar has two wordmarks and one accessible disclosure", () => {
  const html = renderToStaticMarkup(React.createElement(PiWebTitle, { label: "Pi Web Ex version details" }));
  assert.match(html, /aria-label="Pi Web Ex version details" aria-expanded="false"/);
  assert.match(html, /class="sidebar-brand-full" aria-hidden="true">Pi Web Ex/);
  assert.match(html, /class="sidebar-brand-compact" aria-hidden="true">πx/);
  assert.doesNotMatch(html, /sidebar-version-card/);
});

test("compact wordmark and version card do not widen the sidebar", async () => {
  const css = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");
  assert.ok(css.includes('[data-fit="2"] .sidebar-brand-full { display: none; }'));
  assert.ok(css.includes('[data-fit="2"] .sidebar-brand-compact { display: inline; }'));
  assert.match(css, /[.]sidebar-version-card [{][^}]*position: absolute;/);
});
