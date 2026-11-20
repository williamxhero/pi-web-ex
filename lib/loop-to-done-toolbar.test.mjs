import assert from "node:assert/strict";
import { test } from "node:test";
import { getLoopPhase, getLoopToDoneState, loopPhases } from "./loop-to-done-toolbar.ts";

test("reads each phase, retry interval and legacy state without inventing activity", () => {
  const read = text => getLoopPhase([{ key: "loop-to-done.phase", text }]);
  for (const phase of loopPhases) assert.equal(read(phase), phase);
  assert.equal(read("retry:30"), "retry:30");
  assert.equal(read("other"), undefined);
  assert.equal(getLoopPhase([status("● 自动续跑：已开启")]), undefined);
});

const status = (text) => ({ key: "loop-to-done", text });

test("the toolbar reflects the extension's explicit off and on states", () => {
  assert.equal(getLoopToDoneState([status("○ 自动续跑：已关闭")]), false);
  assert.equal(getLoopToDoneState([status("● 自动续跑：已开启")]), true);
  assert.equal(getLoopToDoneState([status("● 自动续跑：已开启 · 剩余 0 次")]), true);
});

test("the toolbar is absent without a recognized status from the extension", () => {
  assert.equal(getLoopToDoneState([]), undefined);
  assert.equal(getLoopToDoneState([status("自动续跑 · 剩余 10 次")]), undefined);
  assert.equal(getLoopToDoneState([{ key: "other", text: "○ 自动续跑：已关闭" }]), undefined);
});
