# 灯光市开发约定（v51）

用户要求整站前后端重写、保持原像素风、删除深色模式。此要求覆盖旧版本“不要改 CSS/架构”的历史约定。

- 工作目录为本仓库，远程 `LycheeJin2012/dengguang-city`，原站 `dengguang-city.pages.dev`。
- 保持 Cloudflare Pages + D1 及现有业务数据。不得用本地 QA 数据替换线上内容。
- 仅浅色：米黄色纸面、绿色、粗边框、方块阴影。不要恢复主题按钮或系统深色跟随。
- 当前前端位于 `js/app`，不要恢复已经删除的 `js/home`、`js/page`、`js/admin` 等旧双实例脚本。
- 后端统一工具在 `functions/_core`；保留原 API URL，路由采用 Pages Functions 文件结构。
- `functions/api/_middleware.js` 调用 `ensureDatabase`；增量迁移必须保留数据、可重入、失败可重试。
- 权限检查必须发生在数据访问/写入之前；密码和账号角色修改应先验证全部字段，再原子写入。
- 私有接口 no-store，不能缓存登录态或跨账号复用数据。查询参数不能直接用于 SQL 表名、字段名。
- 业务主表和工单、试车扣费、签到奖励用 D1 batch；不要改回分步写入。
- 安全敏感原语（PBKDF2、WebAuthn、签名）有意复用；修改须加针对性测试，不宣称未做的硬件验证。
- 不读取或输出 `.dev.vars`、真实密钥和用户密码。不擅自安装第三方软件。
- macOS 推荐使用 `$HOME/.local/node-v20.19.0-darwin-arm64/bin/node`；Homebrew Node 曾无法运行。
- 交付前运行 `node --experimental-vm-modules --test tests/*.test.js`、`node --experimental-vm-modules scripts/build.mjs`、`git diff --check`。
- 本地功能测试用 `tests/dev-server.mjs`，打印 localhost:8874，在临时 SQLite 内操作。它不使用生产 D1。
- 推送/部署/线上验证分别报告；不能把 GitHub 推送成功当成 Cloudflare 部署成功。
