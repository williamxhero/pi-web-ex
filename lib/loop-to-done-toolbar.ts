import type { ExtensionStatusItem } from "./types";

const STATUS_KEY = "loop-to-done";

export const ENABLE_LOOP_COMMAND = "/loop-to-done";
export const DISABLE_LOOP_COMMAND = "/stop-loop-to-done";

// Read the extension's status; also recognize older sessions not yet reloaded.
export function getLoopToDoneState(statuses: readonly ExtensionStatusItem[]): boolean | undefined {
  const text = statuses.find(({ key }) => key === STATUS_KEY)?.text;
  if (text === "○ 自动续跑：已关闭") return false;
  if (text === "● 自动续跑：已开启" || (text && /^● 自动续跑：已开启 · 剩余 \d+ 次$/.test(text))) return true;
}

export const loopPhases = ["off","task","turn","judging","sent","retry","completed","blocked","stopped"] as const;
export type LoopPhase = typeof loopPhases[number];
export function getLoopPhase(items: readonly ExtensionStatusItem[]) {
  const raw = items.find(i => i.key === STATUS_KEY + ".phase")?.text;
  if (raw && (/^retry:[1-9]\d*$/.test(raw) || loopPhases.some(p => p === raw))) return raw;
  return getLoopToDoneState(items) === false ? "off" : undefined;
}

export function isLoopToDoneStatus(item: ExtensionStatusItem): boolean {
  return item.key === STATUS_KEY || item.key === STATUS_KEY + ".phase";
}
