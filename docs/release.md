# Pi Web Ex 发布

产品发布在 [williamxhero/pi-web-ex Releases](https://github.com/williamxhero/pi-web-ex/releases)。网页只检查，手动执行 `pi-web update` 更新全局 Ex 安装。不要用上游 npm 包覆盖 Ex。

## 产物和版本

- GitHub Release：标签是 `v{上游版本}+{fork 版本}`，如 `v0.19.0+1.0.0`。
- npm tarball：同一个 Release 下的 `pi-web-ex.tgz`，包名 `@williamxhero/pi-web-ex`，安装后的 CLI 仍叫 `pi-web`。不发布到 npm registry。
- OCI：`ghcr.io/williamxhero/pi-web-ex:0.19.0-ex.1.0.0`。Docker tag 不允许加号，所以镜像 tag 与界面版本字符串不同。

## 发布前检查

1. 根 `package.json` 的 version 跟随上游，fork 发布仅调整 `fork-version.json`。使用 `node -p "require('./bin/ex-product').APP_VERSION"` 核对，不用 `npm version patch`。
2. 确认待发布的提交已在 Ex `main` 且 CI 通过。用 `git ls-remote --tags https://github.com/williamxhero/pi-web-ex.git` 排除重复 tag。生产构建与 `npm run release:pack` 在隔离目录做，不能覆盖运行中的构建。
3. 得到发布授权后，只推送核对过的精确 tag 到 Ex remote。GitHub Actions 检查 tag 后构建包和镜像，二者成功才创建草稿、上传并公开 Release，不要把失败的草稿标成最新版。失败重试前检查是否已有草稿，不覆盖已发布资产。
4. 发布后回读 Release tag、tarball 和镜像；隔离安装该 tarball，核对 `pi-web --version` 以及页面/更新端点响应。不要只检查 npm 包名或 tag 字面。
