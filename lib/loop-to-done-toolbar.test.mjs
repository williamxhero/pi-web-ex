import assert from "node:assert/strict";
import { test } from "node:test";
import { getLoopToDoneState } from "./loop-to-done-toolbar.ts";

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
