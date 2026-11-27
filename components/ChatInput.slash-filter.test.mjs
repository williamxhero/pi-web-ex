import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { filterSlashCommands } = await jiti.import("./ChatInput.tsx");

const t = (key) => key;
const names = (commands) => commands.map((command) => command.name);

const commands = [
  { name: "copy", description: "Copy the last assistant message", source: "builtin" },
  { name: "compact", description: "Compact the context", source: "builtin" },
  { name: "skill:better-writing", description: "Polish UI product copy", source: "skill" },
  { name: "skill:copy-text", description: "Copy text", source: "skill" },
  { name: "skill:deep-copy", description: "Clone objects", source: "skill" },
  { name: "daily-brief", description: "Prepare an assistant brief", source: "prompt" },
];

test("names decide: a description match is dropped while any name matches (#1413)", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "copy", t)), ["copy", "skill:copy-text", "skill:deep-copy"]);
});

test("a skill matches by its bare name, and by its full name with the prefix typed", () => {
  // Bare-name prefix (rank 1) comes before a plain substring (rank 2), like pi's TUI.
  assert.deepEqual(names(filterSlashCommands(commands.slice(2), "copy", t)), ["skill:copy-text", "skill:deep-copy"]);
  assert.deepEqual(names(filterSlashCommands(commands, "skill:copy", t)), ["skill:copy-text"]);
  assert.deepEqual(names(filterSlashCommands(commands, "better-writing", t)), ["skill:better-writing"]);
});

test("descriptions are searched only when no name matches", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "assistant", t)), ["copy", "daily-brief"]);
});

const skillCommands = [
  { name: "skill:to-spec-to-done", description: "Spec, then implement", source: "skill" },
  { name: "skill:to-spec-then-deliver", description: "The longer path", source: "skill" },
  { name: "skill:tour-settings-delete", description: "Unrelated", source: "skill" },
  { name: "skill:dialog-to-audio", description: "Audio", source: "skill" },
];

test("a hyphenated skill name answers to its letters without the separators", () => {
  assert.deepEqual(names(filterSlashCommands(skillCommands, "tospectodone", t)), ["skill:to-spec-to-done"]);
  // The literal ranks still answer a query that spells the `skill:` prefix.
  assert.deepEqual(names(filterSlashCommands(skillCommands, "skill:to-spec", t)), [
    "skill:to-spec-then-deliver",
    "skill:to-spec-to-done",
  ]);
});

test("a name is found by the initials of its segments, or by any subsequence of it", () => {
  assert.deepEqual(names(filterSlashCommands(skillCommands, "tstd", t)), [
    "skill:to-spec-then-deliver",
    "skill:to-spec-to-done",
    "skill:tour-settings-delete",
  ]);
  assert.deepEqual(names(filterSlashCommands(skillCommands, "todone", t)), ["skill:to-spec-to-done"]);
});

test("a single character is no abbreviation", () => {
  assert.deepEqual(names(filterSlashCommands(skillCommands, "z", t)), []);
});

// The `skill:` namespace is not part of a name: typing `/skill` asks for skills
// whose name holds "skill", not for the whole skill list (#9).
const namespaceCommands = [
  { name: "skill:to-spec-to-done", description: "Spec, then implement", source: "skill" },
  { name: "skill:browser-skill", description: "Drive the browser", source: "skill" },
  { name: "skill:writing-great-skills", description: "How to write a skill", source: "skill" },
  { name: "copy", description: "Copy the last assistant message", source: "builtin" },
];

test("the skill namespace counts only when the query spells its colon", () => {
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "skill", t)), [
    "skill:browser-skill",
    "skill:writing-great-skills",
  ]);
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "kill", t)), [
    "skill:browser-skill",
    "skill:writing-great-skills",
  ]);
  // A spelled namespace still browses every skill, and still filters by name.
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "skill:", t)), [
    "skill:browser-skill",
    "skill:to-spec-to-done",
    "skill:writing-great-skills",
  ]);
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "skill:to-spec", t)), [
    "skill:to-spec-to-done",
  ]);
  // The namespace is no abbreviation input either: initials that include its colon's word
  // (`ststd`) name nothing, so `/tstd` stays the way to reach the skill.
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "ststd", t)), []);
  // The bare-name ranks are unchanged.
  assert.deepEqual(names(filterSlashCommands(namespaceCommands, "to-spec", t)), [
    "skill:to-spec-to-done",
  ]);
});

test("an empty query lists everything by source, then name", () => {
  assert.deepEqual(names(filterSlashCommands(commands, "", t)), [
    "compact",
    "copy",
    "daily-brief",
    "skill:better-writing",
    "skill:copy-text",
    "skill:deep-copy",
  ]);
});
