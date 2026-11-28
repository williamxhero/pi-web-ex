import { currentDemoLocale } from "./locale";
import { DEMO_INSTALL_GUIDE } from "./product";

/** Message for actions that need a real Pi Web Ex server. */
export function demoOnlyMessage(): string {
  return currentDemoLocale() === "zh"
    ? `这是静态演示，此操作需要真实的 Pi Web Ex 服务。安装说明：${DEMO_INSTALL_GUIDE}。`
    : `This is a static demo, so this action needs a real Pi Web Ex server. See the installation guide: ${DEMO_INSTALL_GUIDE}.`;
}
