import { currentDemoLocale } from "./locale";

/** Message for actions that need a real Pi Web Ex server. */
export function demoOnlyMessage(): string {
  return currentDemoLocale() === "zh"
    ? "这是静态演示，此操作需要真实的 Pi Web Ex 服务。运行 https://github.com/williamxhero/pi-web-ex#readme 即可完整体验。"
    : "This is a static demo, so this action needs a real Pi Web Ex server. Run https://github.com/williamxhero/pi-web-ex#readme to try it for real.";
}
