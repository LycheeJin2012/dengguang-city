# 后端「去压缩」重写 —— 行为回归审查报告

- 基线 `06e9595`（重写前）／当前 `70a5520`；范围：78 个被重写文件中的 **71 个**
  （跳过清单里 `_shared/auth.js`、`bytes.js`、`http.js` 不在 78 个之列，故实际待查 71 而非 69）
- 结论：**1 个真实回归（中等）+ 1 个可复现但无实际影响的偏差**；其余 69 个文件未发现回归。

---

## 缺陷 1 —— 丢失 action 白名单校验，未知 action 一律走交卷流程

- **文件:行号**：`functions/api/exam-sessions.js:166`
- **缺陷类型**：第 3 类（少了守卫条件）+ 第 6 类（中文提示消失）。不是模板降级、不是漏 import、不是 await 丢失
- **置信度**：**高（真 SQLite 实跑复现）**

基线在 recover 分支之后有一句闸门：

```js
if(action==='recover'){ ... }
if(action!=='submit')fail(400,'操作无效')      // ← 白名单
const revision=integer(...),answers=validateAnswers(...)
```

现版 `exam-sessions.js:144-166` 变成：

```js
if (action === 'recover') { ...; return reply({...}); }

return submitSession(c, player, db, input, row);   // ← 166 行：兜底分支，闸门没了
```

`const action = input.action || 'start'`（:124）与基线一致，**默认值没变**；丢的只是那句白名单。
现在 `action` 只要不是 `start` / `abandon` / `recover`，就一律被当成 `submit` 执行。

**复现（真库，两版同一条命令）**

| `action` | 基线 `06e9595` | 现版 HEAD |
|---|---|---|
| `"submit"` | 200 / 500（走交卷） | 同左 |
| `"delete"` | **400 `操作无效`** | **200**（带回会话数据） |
| `"SUBMIT"` | **400 `操作无效`** | **200** |
| `"start "`（尾空格） | **400 `操作无效`** | **200** |
| `"grade"` | **400 `操作无效`** | **200** |

用「合法答卷 + in_progress 试卷」再跑一组：`bogus-action` 基线 400 `操作无效`、现版 500；
真 `submit` 两版都是 500 —— **现版对 `bogus-action` 和对真 `submit` 的响应逐字节相同**，
证明未知 action 确实落进了交卷路径。

**实际后果**：`owned()` 仍校验试卷归属，非本人仍 404，**401/403 不受影响**；丢的是入参白名单 ——
客户端把 action 写错（`SUBMIT`、`start `、拼错）时基线 400 挡下，现版会**当作交卷执行**。
诚实边界：我的 fixture 无 `OPENAI_API_KEY`，交卷路径在 claim 落库前就 500，
**我没有观察到已提交的状态变更**（`exam_sessions` 仍 `in_progress`、无 `submitted` 事件）。
危害取决于交卷路径自身能否走通（revision 匹配 + AI 评分可用）；一旦走通就是一次**非预期交卷**
（`status→grading`、`revision+1`、写 `submitted` 事件）。这是「丢了校验」，不是「已证实的数据损坏」。

---

## 缺陷 2 —— 看板 SECTIONS 两个键被重排，响应 JSON 键序变化

- **文件:行号**：`functions/api/admin/dashboard.js:12-13`；**类型**：第 6 类（响应体键序，非中文文案）
- **置信度**：**高（实跑复现）**；**影响：无**

基线 `license, kart, circuit` → 现版 `license, circuit, kart`。两版 `states` / `table` / SQL /
`identity(c,'admin')` 全部一致，`tallyByState` 是等价提取。实跑：`GET` 看板（auth=super / adm，8 个场景）
HTTP 均 200、**所有表零差异**，唯一差别是键序
（`old={"license":…,"kart":…,"circuit":…}` vs `new={"license":…,"circuit":…,"kart":…}`）。

**为什么影响可忽略**：这些板块是 `Promise.all` 并发跑完再 `result[key]=…`，插入顺序取决于哪个查询先返回，
两版皆然 —— 键序设计上就不稳定，只是我的 SQLite 桥把请求串行化了才稳定复现。任何 `JSON.parse`
消费者都不受影响；仅当有测试对响应做**字符串**比对时才会炸。

---

## 追查后排除的疑似项（差分先报警、再逐个证伪，均**不是**缺陷）

| 疑似 | 结论 |
|---|---|
| `api/tickets.js`、`admin/ticket-insights.js` 少了 import（`conflicts`/`integer`） | 两版都没用到，是删死引用 |
| `admin/exam-review.js` 403 文案 x2→x1（像掉了自评闸门） | 提取成 `assertNotOwnPaper()`，**两个调用点都在**（:17、:78），鉴权完好 |
| `_core/hotel-owner.js` `WHERE` 21→20 | 提取成 `OWNED_BOOKING`：1 定义 + 2 引用，SQL 逐字相同 |
| `api/social.js` `灯灯客服` x5→x1 | 提取成 `BOT_NAME`，5 个使用点一一对应（:33 :41 :142 :168 :190） |
| `_core/request.js` 少了 `status:409/500` | 搬进 `jsonError()` 助手，状态码与文案不变 |
| `support-chat.js` / `tickets.js` SQL 变形 | 提取成 `LAST_QUESTION_SQL` / `AUTO_REPLY_FIELD`，拼回后逐字相同 |
| `city-map.js` 的 `isManage`、`notifications.js` 的 `unreadOnly`、`exam-questions.js` 的 `order` | 判定式与基线逐字相同（都是 `=== '1'`，没踩 `'0'` 为真的坑） |
| `api/uploads.js` 差异 63 处 | 提取 `STORAGE_LIMIT=250*1024*1024`、`STREAM_BATCH=16`、`maxEncodedLength`、`range416`，取值等价 |
| 任务点名的两个历史 bug | **均已修复**：`exam-appeals.js:1` 已 import `body`；`ticket-updates.js:69` 是正常反引号模板，`${ref.table}` 会插值 |

`_core/dispatch.js` 并发保护逐条核对无误：派单 UPDATE 的 `assignee_id IS NULL AND dispatch_hold=0 AND
status IN (…) AND (SELECT enabled…)=1 AND (SELECT revision…)=? AND (workloadSQL)<(SELECT max_active…)` 全在，
`justAssigned` 与基线 `valid`/`condition` 逐字节相同。

---

## 覆盖范围与验证强度

真 SQLite（`tests/sqlite-bridge.py`）+ 真中间件（`functions/api/_middleware.js`），两版跑**同一串有序场景**，
每步比对 HTTP 码、响应体、**全库所有表的完整快照**：

- **47 个路由** × 336 场景（4 方法 × 7 身份 × 4 query × 3 body）= **15,792 场景/版本**，
  每个文件都有 224 个场景真的改了库（无空跑）。
- **5 个按 pathname 分流的路由**（`support`/`register`/`ui-events`/`admin/messages`/`tickets`）
  另按**真实路径**各跑 192 场景，全部 CLEAN。
- **23 个 `_core` 模块**：导出各用 19 组参数探测，比对返回值/异常 + 全库快照，0 差异。
- **`_core/database.js`** 单独跑：两版建出的 **107 个 schema 对象逐字相同**，`SCHEMA_VERSION` 同为 67。
- 静态面：模板降级扫描（proper lexer）**0 命中**；SQL 字面量多重集比对命中 17 个文件（全是改名/常量提取，已逐个证伪）；
  中文文案多重集比对命中 5 个文件（已逐个证伪，唯一真实项即缺陷 1）。

**没验到的部分（如实说明）**：`env.R2` 为 `null`，故 `api/uploads.js` 分片上传/流式读与 `_core/uploads.js`
的 R2 落盘**没真跑过**（补偿：`_core/uploads.js` token 级比对**完全一致**，966/966 token 0 差异）；
WebAuthn 成功路径需真实凭据，`_core/passkey-verification.js` 只覆盖失败分支；
`_core/customer-answer.js` 主链路（无 `OPENAI_API_KEY`）只能走到 fallback，而该文件被大幅重构
（提取了 `FOLLOW_UP`/`HOTEL_QUERY`/`PLACE_QUERY`/`MAX_QUERY_CHARS` 等），**主链路未被行为验证，是我覆盖最弱的一块**；
真实 D1 与单进程桥在并发时序上有差异，可能掩盖仅竞态下出现的漂移。

---

## 建议

1. `exam-sessions.js:166` 恢复白名单：`if (action !== 'submit') fail(400, '操作无效');`
   （或改成显式 `if (action === 'submit') {…}` 再在末尾兜底 fail）。
2. `dashboard.js` 的 `SECTIONS` 键序与基线对齐即可，纯观感问题。
3. 给 `tests/local-d1.mjs` 的 `dispatch()` 补一条**按真实 pathname**取模块的路径，否则中间件里
   `/api/support`、`/api/register`、`/api/ui-events` 的审计分支在差分测试里永远走不到。
