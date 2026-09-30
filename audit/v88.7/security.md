# 安全边界审查报告 — dengguang-city 后端

- 基线 `06e9595` → HEAD `70a5520`，范围 `functions/`（118 个 .js）
- 只读审查，未修改任何生产代码（`git diff HEAD -- functions/` 为空）
- 复现方式：真 SQLite（`tests/local-d1.mjs` + `sqlite-bridge.py`）+ 真 ES256
- 现有测试套件：**237/237 通过**

## 结论

**这轮「去压缩」重写没有引入任何安全回归。** 逐文件核对了 78 个改动文件里鉴权/数据访问的语句顺序，
未发现一处「先取数据、后校验身份」的顺序倒置。已知的 7 条疑点里，3 条指向的文件在仓库中根本不存在，
其余 4 条经基线对比确认全部是**重写前就存在**的既存问题，本轮原样保留（符合硬约束）。

按硬约束逐项核对的结论：

| 检查项 | 结论 |
|---|---|
| 权限检查在数据访问之前 | ✅ 未发现违规（见下方逐条排除说明） |
| `no-store` | ✅ 全部私有接口都带。`api/_middleware.js:107` 对**所有** `/api/*` 响应强制 `Cache-Control: no-store`，`reply()`/`jsonError`/`_shared/http.js` 三处也各自带 |
| 鉴权绕过 / 越权 / IDOR | ✅ 未发现可利用路径（30+ 条实跑探针全部被正确拒绝） |
| 秘密泄露 | ✅ 未发现。密钥只出现在 `Authorization: 'Bearer ' + env.OPENAI_API_KEY` 的出站请求里 |
| SQL 注入 | ✅ 未发现。所有 `${}` 插值都只来自白名单常量（表名/列名/排序分支），用户值一律走 `.bind()` |
| 路径穿越 | ✅ 不存在。附件 id 走 `validId()` 正则 `/^[-a-zA-Z0-9]{20,64}$/`，不拼文件路径 |
| 存储型 XSS | ✅ 未发现。后端全部返回 `application/json` + `nosniff`；`_headers` 的 CSP 为 `script-src 'self'`；前端用户内容经 `esc()` / `text()` |

## 硬约束 1：权限检查先于数据访问 —— 逐条排除

自动扫描标出 14 个「`identity()` 之前出现 `.prepare()`」的文件，逐一打开确认**全部是误报**：

- `api/social.js:59,67` — 公开资料 `?action=profile`，本就该匿名可读，且只 SELECT 公开字段
- `api/messages.js:30` — `?public=1` 公开墙，同上
- `api/comments.js:19` — 公开评论接口，注释已写明「无需登录」
- `api/_core/resources.js:167…220` — 这些行是**模块级** `insertRow/updateRow/deleteRow` 函数的定义体；
  真正的调用点在 `resources.js:234` 的 `identity()` **之后**（`return` 才执行）
- `api/ticket-comments.js:17` / `api/uploads.js:26` / `_core/uploads.js:40` — 先按 id 取行**再校验归属**，
  但归属不通过一律 `fail(404)`，未校验前**不返回任何数据**，不构成泄露
- 其余为 `onRequestGet` 里匿名分支的正常前置查询

`api/tickets.js:66` 的写法是本项目该遵守的正确范式：
`const who = isPublic ? null : await identity(c, isMine ? 'player' : 'admin');` —— 视角和身份一次绑定。

## 硬约束 2：`no-store`

实跑抽查（真实响应头）：`admin/players` `admin/audit` `social?action=dm-list` `my-affairs`
`notifications` `subscriptions` `messages` 全部 `cache-control=no-store`；401/403 错误响应同样带。
`functions/api/uploads.js:324` 对非公开附件单独设 `private, no-store`。
三条不在 `/api/` 下的路由也已确认：`admin.js:1` 带 `no-store`，`logout.js` 返回 404 空体，`_headers` 亦有 `/api/* → no-store` 兜底。

## 硬约束 3：越权 / IDOR —— 实跑结果

真 SQLite 建 alice/bob/eve/carol 四账号，实跑 30+ 条探针，**无一条可利用**：

| 探针 | 结果 |
|---|---|
| eve 读 alice↔bob 私信串 `social?action=dm-thread&peer=bob` | 200 但 `messages:[]` ✅ |
| eve `dm-list` / `dm-read` alice 的会话 | 空列表；`read_at` 前后均 `null`（未改动）✅ |
| alice 读 `tickets?id=1`（自己的） | 403「需要管理员权限」——该端点只服务后台，玩家走 `?my=1` ✅ |
| eve `tickets?my=1` | 只回自己 3 张单，bob 的单不出现 ✅ |
| 匿名 `tickets?public=1` | 只回 `public_consent=1 AND public_visible=1` 的单，私密单不出现 ✅ |
| eve 读 bob 的私密工单评论 | 404 ✅ |
| alice 删 bob 的评论 `comments?id=2` | 403「只能删除自己的评论」，行仍在 ✅ |
| 36 个 `admin/*` 路由 × {匿名, 普通玩家} × {GET,POST} | 全部 4xx，**0 例外** ✅ |
| 非超管 `admin/admins` `admin/players` `actions/admin-dm` | 403「仅限 SUPER」✅ |
| mod（即被举报人本人）处理针对自己的工单 | 403「被投诉或被举报人不能处理自己的工单」✅ |
| 跨站写 `Origin: evil` / `Sec-Fetch-Site: cross-site` | 均 403 ✅ |

## 硬约束 4/5：秘密泄露 / 注入

- 无密钥、密码哈希、token、内部路径进入响应或日志。`dispatch-settings.js:16` 只回布尔
  `ai_configured: !!c.env.OPENAI_API_KEY`；`request.js:184` 把异常细节只写 `console.error` 不进响应体。
- SQL 全部参数化。`exam-questions.js:40` 的 `ORDER BY ${order}` 只取 `'RANDOM()'`/`'id'` 二值；
  `dispatch.js`/`submissions.js`/`resources.js` 的 `${table}`/`${column}` 均来自模块内常量定义。

---

# 既存问题（非本轮回归，需单独工单）

## P1-1 订阅表缺 UNIQUE 约束，并发重订阅插重复行
**文件**：`functions/api/subscriptions.js:30-49`；schema 见 `functions/api/_schema.js:282-290`
**基线 vs 现版**：**完全一致**。`git show 06e9595:functions/api/subscriptions.js` 是同样的
「先 `SELECT` 查重、再 `INSERT`」两步走，两版都无 UNIQUE 约束 → **既存问题，本轮原样保留**。
**触发条件**：同一玩家并发调 `POST /api/subscriptions`。check-then-insert 之间有竞态窗口。
**实跑复现**：6 个并发请求 → 库里留下 **4 行**重复订阅（预期 1 行）。
**影响**：取消订阅时 `UPDATE ... WHERE id=?` 只关掉其中一条，重复行导致**用户无法彻底退订**，
并可能被 `resources.js:198` 的公告通知 `SELECT DISTINCT` 之外的去重逻辑重复打扰。属数据一致性，非越权。

## P1-2 COSE 公钥解析用固定字节偏移，真实变体会静默错位
**文件**：`functions/_shared/webauthn.js:78-79`（`coseToJwk`，`slice(10,42)` / `slice(45,77)`）
**基线 vs 现版**：`coseToJwk` 本轮**未改动**（diff 只涉及 `signCount` 空格、`resolveSubject` 抽取）→ **既存问题**。
**实跑复现**（真 P-256 密钥，三种 CBOR 编码）：

| 变体 | 结果 |
|---|---|
| 规范 77 字节 `22 58 20` | ✅ 解析结果与真实坐标**逐字节一致** |
| x 截前导零 76 字节 | ✅ 长度检查拦下并抛错（fail-closed，安全） |
| **x 用 `59 00 20`（2 字节长度头，79 字节）** | ❌ **长度 ≥77 通过检查，静默解析出错误坐标** |

**影响**：某些认证器/CTAP 实现若用非最小长度头编码 x，注册时会存入**错误的公钥**，
表现为该设备注册后无法登录（fail-closed，不构成越权或伪造）。
**说明**：`tests/shared-equiv.test.js` 的 `coseKeyFromJwk` 固定造 77 字节布局，
与被测模块的假设同源，**测不出该问题**。
**建议**：改用真正的 CBOR 解析，或至少校验 `b[7]===0x22 && b[8]===0x58 && b[9]===32`。

## P2-1 signin GET 吞掉 401，停用账号拿到「未登录壳」
**文件**：`functions/api/actions/signin.js:50-58`（经 `functions/api/init.js:40` 以 `?action=signin-status` 暴露）
**基线 vs 现版**：查基线同一分支，逻辑相同 → **既存问题**。
**实跑复现**：停用账号（`status='banned'`）带有效会话调 `GET /api/init?action=signin-status`
→ **200** `{logged_in:false, signed_today:false, current_streak:0, recent:[]}`，而非 401。
**影响**：**不泄露任何私有数据**（返回的是空壳，字段全为零值）。
真实危害是可用性/语义：前端无法区分「未登录」与「账号被停用」，停用用户会一直看到登录态页面而不知被封。
对应的 `POST` 路径正确返回 401「账号未激活或已停用」，说明只有 GET 的渲染分支有意放行。
**判定**：疑点成立但危害等级低，属产品语义问题而非安全边界破坏。

## P2-2 WebAuthn 验签失败也消耗 challenge
**文件**：`functions/_shared/webauthn.js:371-372`（`passkeyLoginFinish`，DELETE 先于 `verifyEs256`）
**基线 vs 现版**：基线同序 → **既存问题**。
**判定**：**不构成 replay 风险，实为正确取舍**。challenge 先删是 fail-safe：
验签失败后 challenge 已失效，攻击者无法用同一 challenge 重放。
若改为验签后再删，并发双花反而可能成功。代价只是用户需重新发起一次登录（可用性折中）。
**建议**：不改，或改为「验签失败后重新签发 challenge」以改善体验。

## P2-3 signCount 克隆检测只告警不拦截
**文件**：`functions/_shared/webauthn.js:395-397` —— `console.warn('疑似克隆')` 后照常 `UPDATE` 并放行
**基线 vs 现版**：基线同为 warn-only（`git show 06e9595:...` L393-395）→ **既存问题**。
**影响**：passkey 被克隆后，原始凭证与克隆凭证可并发使用，计数器回退本应吊销该凭证。
属 WebAuthn 规范偏离，非本轮引入。

## P3-1 `validators.js` 的 `oldest` 查出未用
**文件**：`functions/_shared/validators.js:19-22`
**基线 vs 现版**：基线 `const oldest = await ...` 同样取出即弃，本轮仅把 `const oldest =` 改成裸 `await` 并加注释 → **既存问题**。
**影响**：`rateLimit` 的 `retryAfter` 恒返回窗口值（60s）而非真实剩余时间，
限流提示不精确。属功能瑕疵，**不影响限流是否生效**（`n >= limit` 判断本身正确）。

## P3-2 前端附件选择器的运算符优先级（不在 `functions/` 内）
**文件**：`js/app/features/attachments/picker.js:55` —— `item.error || item.ready ? '已传到市政厅' : ...`
**基线 vs 现版**：该文件由 v88.6 提交（`094eb7e`）引入，**不在本轮 `06e9595..HEAD` 变更范围**内。
**判定**：疑点**成立**（`||` 优先级高于 `?:`，`item.error` 为真时确实显示「已传到市政厅」），
代码注释也已明确记录这是刻意保留的旧行为。属 UI 文案误导，无安全影响；且第 64 行仍会渲染「再传一次」按钮，用户有恢复路径。

---

# 疑点文件不存在（3 条）

以下三条疑点指向的路径在**基线、全历史、当前 HEAD 中均不存在**，疑点描述与代码库不符：

| 疑点 | 实际情况 |
|---|---|
| `functions/api/admin/tabs/tickets.js` 传 `ticketUploadsRef` 函数本身 | 该文件在任何提交中都不存在；`grep -rn "tabs/" functions/` 零命中 |
| `functions/api/attachments.js` 上传优先级问题 | 文件不存在；实际是 `functions/api/ticket-attachments.js`（仅 52 行，无该逻辑）。`已传到市政厅` 字符串只出现在前端 `js/app/features/attachments/picker.js:55`（见 P3-2） |
| `functions/api/signin.js` | 文件不存在；签到逻辑在 `functions/api/actions/signin.js`，经 `functions/api/init.js` 的 `?action=` 路由暴露（见 P2-1） |

# 验证边界

- 以上结论基于静态审查 + 真 SQLite 实跑。**未做**真实浏览器端 XSS 验证、CSP 运行时验证、
  真实 WebAuthn 认证器联调（P1-2 的偏移问题是用构造的 CBOR 字节流复现的，非真机）。
- 未审计 `js/` 前端渲染层的安全（本次范围限定 `functions/`），仅抽查了用户内容转义路径。
- 未验证 Cloudflare 平台侧行为（WAF、Rate Limiting、Workers 运行时配置），这些不在仓库内。
