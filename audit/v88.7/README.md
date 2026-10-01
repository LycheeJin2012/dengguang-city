# v88.7 审查存档

`06e9595`（重写前基线）→ 去压缩重写，由 4 个独立审查 agent 交叉验证，再补了 6 份行为差分测试。

## 四份审查

| 报告 | 范围 | 结论 |
|---|---|---|
| `regression.md` | 71 个重写文件的行为差分，真 SQLite + 真中间件，两版同场景 | 1 个真回归（已修）+ 1 个零影响偏差 |
| `security.md` | 鉴权顺序、越权、no-store、注入、秘密泄露 | **未发现重写引入的回归** |
| `untouched.md` | 40 个逐字未动、从未审查的文件 | 无数据损坏、无鉴权绕过 |
| `frontend.md` | v88.6 前端 87 文件、模块拆分、CSS 断层 | 1 个真缺陷（已修） |

四份都如实写明了**没验到的部分**，别把「未发现缺陷」当成「已证明无缺陷」。

## 重写收尾

审查时 `functions/` 下还有 40 个文件逐字未动。核查后其中 29 个本就是规范写法
（形如 `export const onRequest = submissions('circuit')` 的两行委托 shim，
长度来自标识符而非代码挤压），重写只会制造无意义 diff。真正待重写的是 10 个，
已在 `117364f` 全部收尾 —— 至此 `functions/` 下 118 个文件全部是可读代码。

`functions/api/_schema.js` 例外：372 行迁移脚本，88 条生产已执行 SQL，**不得改动**。

## 行为差分测试

| 测试 | 用例 | 覆盖 |
|---|---|---|
| `backend-equiv.test.js` | 5 | 78 个文件的 export 名单 + submissions/chat-support 行为 |
| `shared-equiv.test.js` | 14 | `_shared/` 7 个模块，真 ES256 签名与 PBKDF2 |
| `customer-answer-equiv.test.js` | 7 | 主链路真调模型（此前无 `OPENAI_API_KEY` 只能走 fallback） |
| `uploads-equiv.test.js` | 22 | 上传全链路（建草稿/PUT/Range/流式读/配额/GC） |
| `login-equiv.test.js` + `login-auth-equiv.test.js` | 19 | 认证入口 + 全站公共 helper |
| `admin-actions-equiv.test.js` | 14 | passkey-debug / admin-player / 孤儿 announcements |

全部对 `06e9595` 做真 B/N 差分：真 SQLite、真中间件，逐场景比对状态码 +
响应头 + 响应体 + 抛出的异常 + 每条 SQL 原文 + 全库完整快照。

## 已修

- `f50813c` exam-sessions 交卷分支丢失 action 白名单（本轮重写引入的真回归）
- `2b623f9` 灯灯浮窗 Shadow DOM 漏 bump 资源版本号（v88.6 引入）
- `3d0a1ea` 差分测试的秒级时间戳假红（5 次挂 3 次 → 8 次连压全绿）

## 已知遗留（都不是本轮引入，两版一致）

1. **`actions/announcements.js` 是孤儿端点** —— 全仓库无人 import，`init.js` 走
   `_core/resources.js` 正规实现。只能靠直接 POST 非文档 URL 命中，且要求 `super`。
   三个缺陷：`parseInt` 太宽松（`?id=2abc` 真删公告 2）、放行 `data:image/svg+xml`、
   原始 SQL 错误外泄。**建议删除**（删则要连带摘掉 admin-actions-equiv 里 7 个用例）。
2. **COSE 固定偏移** `_shared/webauthn.js` 的 `coseToJwk` 用 `slice(10,42)/slice(45,77)`。
   实跑三种 CBOR：77 字节规范型✅、76 字节被长度检查拦下✅、`59 00 20`（2 字节长度头）
   静默解析出错误坐标❌。**fail-closed**（该设备登不上），非越权。
   `shared-equiv` 的 fixture 固定造 77 字节，测不出这个。
3. **subscriptions 缺 UNIQUE** —— 实跑 6 并发插出 4 行，用户无法彻底退订。
   同项目其余三处都用 `ON CONFLICT`，只有它没有。修它需要往 `_schema.js` 加一条
   生产迁移（含去重现有行 + 建唯一索引），属生产库结构变更，**未做**。
4. `ticketOwner` 的 `fail(403)` 被同函数 catch 吞掉，退化成 401。阻断效果仍在（fail-safe），
   只是错误码错乱。两版一致。
5. `dashboard` 的 JSON 键序不稳定 —— `result` 是普通对象，`Promise.all` 下插入顺序
   取决于哪个 promise 先 resolve。**调 `SECTIONS` 顺序改不了输出顺序，故不动。**
