# Pi Web Ex

本库基于 [Pi Web](https://github.com/agegr/pi-web)，新增了两个会话操作：

| 功能 | 使用方式 |
| --- | --- |
| 复制 Session ID | 在侧栏打开会话的 `⋯` 菜单，选择「复制 Session ID」，即可把该会话的 ID 复制到剪贴板。 |
| 自动续跑开关 | 加载 [loop-to-done 扩展](https://github.com/williamxhero/pi-extension/blob/main/extensions/loop-to-done/README.md)后，在顶部「系统」「工具」右侧点击「自动续跑」即可开启当前会话的续跑，再点一次关闭。关闭不会打断正在生成的回复。 |

按钮右侧的图标显示当前进度：等待任务、等待本轮结束、判断下一步、发送指令和等待重试时，图标以 0.5 秒节奏自行播放；关闭、完成、阻塞和手动停止时静止。悬停可看状态说明，开启系统「减少动态效果」后不播放动画。

自动续跑的监督逻辑由独立插件提供，本库负责显示状态和转发按钮操作。

Pi Web 的安装、配置和基础功能见[上游中文 README](https://github.com/williamxhero/pi-web-ex/blob/main/docs/README.zh-CN.md)。
