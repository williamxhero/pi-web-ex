<img align="right" src="./ex-badge.svg" alt="Pi Web Ex" width="76" />

# Pi Web Ex

Pi coding agent 的浏览器界面。Ex 版增加了可见可停的后台任务、插件配置面板和更易用的输入框命令搜索。

## 开始使用

当前源码对应 **0.19.0+1.0.0**（上游 + fork）。需要 Node.js 22.19.0 或更新版本：

~~~sh
git clone https://github.com/williamxhero/pi-web-ex.git
cd pi-web-ex
npm ci
npm run dev
~~~

打开 <http://127.0.0.1:30141>。产品发布、下载与更新统一走 [Pi Web Ex Releases](https://github.com/williamxhero/pi-web-ex/releases)；正式首发前请使用上述源码方式。已发布后可下载其中的 `pi-web-ex.tgz`，再运行 `npm install -g ./pi-web-ex.tgz`。原来安装上游包的用户请先停止旧服务并卸载旧包，再安装 Ex；不需要删除 Pi 会话或配置目录。

网页只自动检查，不下载或安装。使用发布包时，`pi-web update --check` 只查版本，手动运行 `pi-web update` 才安装 Ex 新版；不会安装上游包。更多见[发布说明](docs/release.md)和[容器使用](docs/docker.md)。问题请提交到 [Ex Issues](https://github.com/williamxhero/pi-web-ex/issues)。

## Fork 功能

| 功能 | 使用方式 |
| --- | --- |
| 复制 Session ID | 在侧栏打开会话的 `⋯` 菜单，选择「复制 Session ID」，即可把 `session={ID}` 形式的会话 ID 复制到剪贴板。 |
| 自动续跑开关 | 加载 [loop-to-done 扩展](https://github.com/williamxhero/pi-extension/blob/main/extensions/loop-to-done/README.md)后，在顶部「系统」「工具」右侧点击「自动续跑」即可开启当前会话的续跑，再点一次关闭。关闭不会打断正在生成的回复。 |
| 插件设置 | 打开「设置 › 插件」选中插件，直接在详情页改它的配置：开关、滑块、输入框、下拉，可存到全局或本项目的 `.pi`。界面由插件的描述文件决定（插件自带 `pi.config.json`、`~/.pi/agent/plugin-configs/`、或本库自带的 [`plugin-configs/`](plugin-configs)），见 [格式说明](docs/plugin-config.md)。包与散装扩展同一套机制；本库已带 pi-image-slim、pi-condense、visual-explainer、loop-to-done 四份描述；项目没覆盖的键会显示全局的值并标「继承全局」。 |
| 受管后台任务 | 独立开发任务通过内置 `Agent` 登记在父会话家族：父会话回复后仍显示运行状态，刷新后可从 **Agents** 打开实时输出并停止；派发失败时不要另启一份 Pi。Windows 自动化命令不开控制台、不抢焦点。参见[受管委托与 Windows 自动化指南](docs/agents/subagents.md#managed-delegation-operator-and-agent-guide)。 |
| 输入框命令面板 | 在已写好的草稿里任意词首输入 `/` 即可选命令，面板按 `/` 后的文字过滤，选中只替换该命令词；路径、网址、分数和 `!` shell 行里的 `/` 不触发。取名可用缩写：`/tstd`（每段首字母）、`/tospectodone`（去掉连字符）或 `/todone`（跳字）都能找到 `to-spec-to-done`；命中多个时全部列出，字面匹配仍排在缩写之前。技能名前的 `skill:` 只算命名空间：`/skill` 只找名字里含 skill 的技能，写全 `/skill:` 才列出全部技能。 |
| 删除技能 | 在「设置 › 技能」选中技能后点底部「删除技能」。只删 pi 技能目录里的技能；包、插件和设置路径里的技能会说明原因并保留文件。 |

按钮右侧的图标显示当前进度：等待任务、等待本轮结束、判断下一步、发送指令和等待重试时，图标以 0.5 秒节奏自行播放；关闭、完成、阻塞和手动停止时静止。悬停可看状态说明，开启系统「减少动态效果」后不播放动画。

自动续跑的监督逻辑由独立插件提供，本库负责显示状态和转发按钮操作。

## 来源与文档

本项目基于 [Pi Web](https://github.com/agegr/pi-web)，保留原许可证与署名。原版基础功能见[上游中文说明归档](https://github.com/williamxhero/pi-web-ex/blob/main/docs/README.zh-CN.md)；安装和更新以本页为准。
