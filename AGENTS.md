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

- v52：一级菜单定义在 `js/app/admin-navigation.js`，工单中心、派单固定排前两位。分组必须按角色过滤，保留原子页 hash。
- 上传策略在 `shared/uploads.js`，图片 20 MiB、视频 100 MiB、每单 5 个/200 MiB。不得把工单附件公开或重新塞进大体积 data URL。
- `media_chunks` 和 `ticket_attachments` 使用 WITHOUT ROWID；工单创建批次依赖此特性保持 last_insert_rowid 指向工单。附件数量/总大小由数据库触发器并发兜底。
- 文件上传和派单的真实验证仅用本地测试账号。生产验证只查看页面/元数据，不创建假举报、假工单或测试附件。

- v53：查看和登录不记审计日志（用户明确要求）。业务变更和导出留痕；不要新增点击/浏览埋点。
- 公开工单必须同时有 public_consent 与 public_visible，公开 API 白名单返回脱敏字段，不带附件、联系方式和私密历史。
- 办结奖励使用 ticket_rewards 唯一账本和原子批次，不能重复发放或根据客户端金额发奖。账号绑定后可补发待领奖励。
- 酒店老板账号仅由超管创建，所有自助接口必须按 hotels.owner_id 校验归属。投诉对象必须回避处理及派单。

- v54：新提交工单自动派单，逻辑在 functions/_core/dispatch.js。紧急优先 wzc、复杂优先漫画家，账号必须唯一匹配或由超管指定编号；回避/工作量上限优先于 AI。
- 自动派单是显式系统业务操作，原子更新、办理事件、审计及通知一起提交。不能在查看/登录时派单，也不能覆盖人工派单、取消派单或已结束记录。
- 历史经验为近 180 天同类实际承办完成记录；至少 3 个样本，禁止称为已训练模型或已证明服务质量。生产不创建假工单验收。
