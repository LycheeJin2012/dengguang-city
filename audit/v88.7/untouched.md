# 未审查代码缺陷排查报告 —— 40 个未改写文件

范围：`git diff --name-only 06e9595 HEAD -- functions/` 的补集，40 个 .js。环境：真 SQLite
（`tests/local-d1.mjs` + `sqlite-bridge.py`）+ 完整中间件链，走 `dispatch()`。
测试基线 `node --test tests/*.test.js` → **237 pass / 0 fail**（既有测试对本轮问题零覆盖）。
只读审查，未修改 `functions/` 下任何文件。

**逐字校验**：40 个文件在 `06e9595`、`70a5520`、工作区三处 sha256 全部一致，故**每一条都是既存问题，
与本轮重写无关**。每条都在基线 `06e9595` 跑了同一条命令复现，两版输出相同（下文 `HEAD≡BASE`）。

## 结论摘要

**未发现数据损坏，未发现鉴权绕过。** 认证面（login / logout / passkey-debug / announcements）
实测权限判定全部正确 —— 详见「已排除的怀疑」一节，我怀疑过但**证伪**的问题没有写进缺陷列表。

真实问题集中在一点上：`functions/api/actions/announcements.js` 是一份**与正式路由并存、
仍可直接访问的第二套公告写入实现**，它与正式实现（`_core/resources.js`，本轮重写过）
在副作用和校验上已经漂移。

## 缺陷（按严重性排序）

### 1. 旧公告写入路径静默丢失订阅推送 —— 数据/逻辑
- **位置**：`functions/api/actions/announcements.js:43-49`（`announcement-create`）
- **类型**：逻辑错（漏副作用）
- **片段**：该分支只 `INSERT INTO announcements`，没有 `INSERT INTO notification_log`。
  正式实现 `_core/resources.js:193-202` 在同一次 `batch()` 里对
  `subscriptions`/`players` 做了 `INSERT ... SELECT DISTINCT` 推送。
- **触发条件**：以 super 身份 `POST /api/actions/announcements?action=announcement-create`。
  `functions/_routes.json` 不存在，故该文件路径在生产**可直接路由访问**，不是死代码。
- **影响**：公告成功入库并返回 200，但**所有订阅了公告的在册市民收不到任何通知**。
  正式路径同样内容返回 201 且推送 1 行。前台与后台看到「发布成功」，玩家端静默无感知。
- **验证**：实跑。同一 DB 内先走旧路径再建正式路径 → `notificationRows: 1`（只有正式路径那一条）。
  `HEAD≡BASE`。**既存**。置信度：高。

### 2. 旧公告路径放行正式路径拒绝的图片类型 —— 逻辑错
- **位置**：`functions/api/actions/announcements.js:35-37`
- **类型**：输入校验不一致
- **片段**：`if (image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\//i.test(image_url))`
  正式实现 `_core/resources.js:117-127` 要求 `data:image/(png|jpeg|webp|gif);base64,`。
- **触发条件**：`image_url="data:image/svg+xml,<svg onload=alert(1)>"`。
- **影响**：SVG data URI 被写入并由公开接口 `GET /api/announcements` 原样返回（旧 200 / 正式 400）。
  **不是 XSS**：前台 `announcementCard` 用 `text()`→`esc()`、`recordCard` 对 title 走 `esc()`，
  图片只进 `<img src>`，SVG 在 img 上下文不执行脚本。实际影响是内容策略绕过与伪造风险。
- **验证**：实跑。`HEAD≡BASE`。**既存**。置信度：高（XSS 部分为静态推断，已核对渲染代码）。

### 3. `parseInt` 解析 id，尾部脏数据被静默接受 —— 输入校验
- **位置**：`functions/api/actions/announcements.js:22, 52`
- **类型**：逻辑错（违反项目自有不变量）
- **片段**：`parseInt(url.searchParams.get('id') || '0', 10)`
- **触发条件**：`?id=2abc`
- **影响**：`parseInt` 截断为 `2` → **删除了 id=2 的公告并返回 200**；`?id=1zzz` 同样改写了 id=1。
  这正是 `_core/request.js:19-27` 明文禁止的写法（注释：「它对 '12abc' 返回 12」），
  同项目 `integer()` 已提供严格替代。权限限 super，故影响面小。
- **验证**：实跑。`idsBefore [1,2]` → `?id=2abc` → `idsAfter [1]`。`HEAD≡BASE`。**既存**。置信度：高。

### 4. 原始 SQL / 表名错误信息直接回给客户端 —— 500 错误 + 信息泄露
- **位置**：`functions/api/actions/announcements.js:26,46,57`；`functions/api/actions/admin-passkey-debug.js:47`
- **类型**：500 错误处理
- **片段**：`return err(500, '删除失败: ' + e.message)` ／ `return err(500, 'debug 错误: ' + (e?.message || String(e)))`
- **触发条件**：任一 SQL 失败（迁移未跑、表缺失、约束冲突等）。
- **影响**：客户端拿到 `删除失败: no such table: announcements`、
  `debug 错误: no such table: passkeys`。正式路径同样故障只回
  `服务处理失败，请稍后重试`（`endpoint()` 兜底）。等于把库表结构与 SQL 细节发给前端，
  也让前端拿到非约定文案。两种行为同屏并存。
- **验证**：实跑（`DROP TABLE` 制造故障）。`HEAD≡BASE`。**既存**。置信度：高。

### 5. `_helpers.parseSession` 不认 header 鉴权，与全站 `readToken` 不一致 —— 逻辑错
- **位置**：`functions/api/_helpers.js:6-16`
- **类型**：逻辑错（鉴权入口分叉，fail-closed）
- **片段**：`const m = ck.match(/lc_session=([^;]+)/);` —— 只读 Cookie。
  `_shared/session.js:71-81` 的 `readToken` 还接受 `X-Session-Token` 与 `Authorization: Bearer`。
- **触发条件**：用 header 鉴权的 super 调 `POST /api/actions/admin-passkey-debug`。
- **影响**：同一个合法管理员会话，`GET /api/login` 认（200），
  passkey-debug 判 401 `需要管理员登录`（实跑：cookie 200 / `X-Session-Token` 401 / `Bearer` 401）。
  方向是**拒绝而非放行**，不是鉴权绕过；属可用性/一致性问题。
- **验证**：实跑。`HEAD≡BASE`。**既存**。置信度：高。

### 6. 缺 `CF-Connecting-IP` 时限流退化为「按用户名的全局桶」—— 逻辑错（环境相关）
- **位置**：`functions/api/login.js:17-18`
- **类型**：逻辑错
- **片段**：`const ip = c.request.headers.get('CF-Connecting-IP') || 'local';`
  指纹 = `sha256(ip + '|' + username)`。
- **触发条件**：请求不带 `CF-Connecting-IP`（本地 / 预览环境 / 非 Cloudflare 边缘）。
- **影响**：所有客户端共享 `local` 桶 → **任意匿名者 10 次错密即可把该用户名锁 10 分钟**，
  正确密码也返回 429（实跑确认）。
- **生产影响**：`login.js:17` 在 Cloudflare 生产必定带该头，实测 `1.1.1.1` 失败 10 次后
  `2.2.2.2` 仍可正常尝试（按 IP 分桶），故**生产不构成全站锁号**，仅本地/预览环境成立。
- **验证**：实跑。`HEAD≡BASE`。**既存**。置信度：高（生产影响面小，已实测确认）。

### 7. `bytesToB64url` 忽略 byteOffset/byteLength —— 代码质量（当前潜伏）
- **位置**：`functions/_shared/bytes.js:26-30`
- **类型**：代码质量 / 潜在数据错
- **片段**：`new Uint8Array(buf.buffer || buf)`
- **影响**：对 `subarray` 视图会编码整个底层 buffer。实跑：
  `bytesToB64url(big.subarray(4,8))` 得到 `AAAAAAECAwQAAA`（10 字节）而非 `AQIDBA==`（4 字节）。
- **当前不可达**：已核对全部 11 处调用点（`webauthn.js` / `passkey-verification.js`），
  传入的都是 offset=0 的新数组（`TypedArray.prototype.slice()` 是**拷贝**，故
  `parseAuthData` 的 `authData.slice(0,32)` 安全）。属埋雷，非现网 bug。
- **验证**：实跑（函数级）+ 静态（调用点全量核对）。`HEAD≡BASE`。**既存**。置信度：高。

### 8. 杂项（代码质量，均为既存、置信度高）
- `functions/_shared/bytes.js:10-16` `hexToBytes`：非十六进制得 `NaN`，写入 `Uint8Array` 被静默转成 `0`；
  奇数长度 hex 静默截断。实测 `verifyPassword('x','abcd','zz')` 不抛错 —— 损坏的 salt 会
  **静默变成错误的 salt** 去比对，而不是报错。
- `functions/_shared/auth.js:29` `timingSafeEqual`：`storedHash` 为 null/undefined 时读 `.length`
  抛 `TypeError`（实测）→ 500 而非 401。当前不可达：相关表 `password_hash` 均为 `NOT NULL`。
- `functions/api/ai-bot.js:3`：`onRequestGet` 经 `getOrCreateAiBot` **写库**（INSERT 玩家行）。
  GET 带副作用，浏览器预取即可触发。已鉴权，影响极低。
- `functions/logout.js:1`：整个文件是 404 桩。前台实际走 `DELETE /api/login` 与
  `/api/init?action=admin-logout`，登出本身**实测正常**，故非安全缺陷，只是误导性死文件。
- `functions/api/actions/admin-passkey-debug.js`：鉴权实测正确（无会话 401 / 玩家 401 /
  普通 admin 403 / super 200）。`admin-passkey-debug`（只读导出）被 `_core/audit-policy.js:22`
  列为免审计，但两个**破坏性** action（`fix-jwks` / `reregister`）不在免审计名单，会正常落审计。
  导出内容为公开材料，不含私钥。**无问题**。

### 9. `functions/api/_schema.js`（372 行）—— 只审查，未发现缺陷
逐条比对 `ALTER TABLE ... ADD COLUMN` **无重复目标**；`database.js:126-134` 对迁移错误只吞
`duplicate column name`，其余照抛，不存在半迁移被标记成功的情况。按要求**不建议任何修改**
（改动会导致生产库与代码不同步）。

## 已排除的怀疑（实跑证伪，不计入缺陷）

- **`logout.js` 404 → 登出失效**：证伪。`DELETE /api/login` 真删 session 行、复用旧 token 返 401、`Max-Age=0`。
- **`admin-passkey-debug` 生产暴露 / 绕过鉴权**：证伪。无会话 401、玩家 401、普通 admin 403、super 200。
- **login 未校验 admin 状态**：证伪。`admins` 表根本没有 `status` 列，不存在漏检。
- **`admin-passkey-reregister` 无审计**：证伪。不在 `audit-policy.js` 免审计名单，正常落审计。
- **公告 `content` 存储型 XSS**：证伪。`text()`/`recordCard` 均走 `esc()`，SVG 仅进 `<img src>`。
- **`admin-player.js` 请求改写丢 body**：证伪。改写为 GET 是刻意的（强制走列表分支），该分支不读 body。
- **`resource('...')` 名称不存在致 500**：证伪。7 个资源名在 `_core/resources.js` 全部有定义。
- **授权状态机跳跃**：无跳跃。但状态机在 `_core/submissions.js`——属**本轮重写文件，不在本次 40 个范围内**。
  附带观察（归属他人范围、不计入缺陷）：`adminSubmissions` 只需 `identity(c,'admin')`，普通 admin 即可
  把驾照判为 `passed`，与公告写入要求 `super` 的权限模型不一致。

## 复核方法

```bash
cd "/Users/Lychee Jin/Desktop/网页制作/dengguang-city-git"
# 把 06e9595 的 functions/tests/shared 解到独立目录：模块路径不同，无 ESM 缓存冲突
git archive 06e9595 functions tests shared | tar -x -C .vfy-untouched/
# 同一份探针分别跑 HEAD(相对路径 ../) 与 BASE(./)，逐字段对比
```

`HEAD≡BASE` 即由此得出。探针在 `.vfy-untouched/`（未 commit）。未新增/修改任何测试文件。

## 未覆盖 / 无法判定

- 基于 `tests/sqlite-bridge.py` 的 SQLite 行为，**未在真实 Cloudflare D1 上跑过**。D1 与 SQLite 在
  并发事务、`batch` 语义上可能不同 —— 依赖 `changes()` 串联的 `circuit` 扣费-报名原子性未在 D1 上验证。
- 真实 WebAuthn 认证器端到端流程未测，`_shared/webauthn.js` 结论只到静态与单元层面。
- 未做并发压测；登录限流的竞态（10 次并发失败同时越过阈值）未验证。
