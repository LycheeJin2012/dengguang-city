# v77 — Admin 工作区分层重构

> 基础：v76（home previews + 灯灯浮窗 + 顶导）。
> 用户要求："重新设计所有结构"，全部页面。

## 本轮目标

把 admin.js（521 行，单文件塞了 12 个 tab + 共用工具 + 数据表）拆成
分层模块，向 `js/app/` 子目录结构走第一步。本轮**只拆 admin**，js/app/

的其它 34 个模块保持单文件不动；下一轮（v78）按同样模式推进。

## 已完成

### 1. 新目录结构

```
js/app/admin/
  state.js       共享状态（active / view / root / historyBound）
  shared.js      共用工具 + 数据表（names / resources / refreshStats /
                 table / toolbar / bindList / params / attachExport /
                 resourceList / signups / isSuper / canHandleTicket）
  index.js       render + switchTab + loadActive + 9 个 tab 函数
                 （v78 再拆到 tabs/ 目录）
  tabs/          空目录，预留给 v78

js/app/admin.js  转发层（`export { render } from './admin/index.js'`）
```

- admin.js 从 521 行 → 14 行（只有 import + export）
- shared.js 21 KB（共用工具）
- index.js 44 KB（render + 路由 + 9 个 tab 函数内联）
- state.js 800 B（共享状态）

### 2. 路由注入避免循环依赖

shared.js 里的工具（refreshStats、toolbar、resourceList、signups）原本依赖
全局的 `switchTab` / `loadActive`。拆开后改成**注入式**：

- shared.js 暴露 `setRouter({ switchTab, loadActive })`
- admin/index.js 在 `render()` 开头调用 `setRouter({...})`
- 工具内部：`switchTab = onSwitch || _router?.switchTab`

这样 shared.js / index.js 互相不直接 import 对方的方法。

### 3. 后向兼容

- entry.js 的 `import('./admin.js')` 路径不变
- tests/frontend.test.js 第 4 行扫描所有 .js 文件做 module link 仍通过
- 19 个测试文件中，185/186 通过；唯一失败是 copy-lock（见下方）

## 已知问题

### Copy-lock 失败（测试 9）

```
not ok 9 - copy-lock: every file in COPY_LOCK.json is byte-identical to its recorded SHA-256
```

原因：COPY_LOCK.json 锁定了 admin.js 的 v76 hash，我替换了 admin.js。
本次重构必然破坏 lock，需要：

1. 重新计算所有已改动文件的 SHA-256 并更新 COPY_LOCK.json
2. 或把 admin.js 从 lock 中移除（标记为 mutable）

**未自行处理**，等用户拍板。

### Tab 函数仍在 index.js 内联

index.js 现在 ~44 KB，包含 players/tickets/admins/dms/times/questions/
password/owners 共 8 个 tab 函数（v76 用 inline closure 写法压缩到一行）。
v78 计划拆到 admin/tabs/{name}.js，每个 tab 一个文件。

dispatch tab 复用 ticketsTab（dispatching=true），拆出去时也要拆。

## 下一轮（v78）

1. admin/tabs/{tickets,players,admins,dms,times,questions,password,owners}.js
2. admin/tabs/resources.js（通用资源 tabs）
3. admin/tabs/signups.js（通用报名 tabs）
4. admin/tabs/dispatch.js（拆自 ticketsTab）
5. js/app/state.js（轻量全局 store，取代 core.state 手动同步）
6. js/app/error-boundary.js（unhandledrejection + 离线重试）

## 验证

- npm test：185/186 通过（copy-lock 1 个失败，待人工确认）
- module link 全部通过
- 用户本地操作，未推送未部署

---

# v78 — Admin/tabs/ 拆分（已交付）

## 已完成

admin/index.js（v77 的 1137 行）→ admin/index.js（233 行）+ 8 个 tabs/*.js：

| 文件 | 行数 | 内容 |
|---|---:|---|
| `js/app/admin/index.js` | **233**（v77: 1137） | render + switchTab + loadActive + tabHandlers 路由 |
| `js/app/admin/tabs/players.js` | 108 | 玩家管理（批准 / 停用 / 重置密码 / 改名） |
| `js/app/admin/tabs/tickets.js` | 467 | 工单管理 + 派单（dispatching 共享 tickets） |
| `js/app/admin/tabs/admins.js` | 118 | 管理员账号 CRUD + 绑定市民 |
| `js/app/admin/tabs/dms.js` | 81 | 私信监管 + AI 建议回复 |
| `js/app/admin/tabs/times.js` | 37 | 赛道成绩审核（toggle verify） |
| `js/app/admin/tabs/questions.js` | 88 | 模拟题库 + AI 出题入口 |
| `js/app/admin/tabs/password.js` | 79 | 管理员账号安全（密码 / 通行密钥） |
| `js/app/admin/tabs/owners.js` | 105 | 酒店老板账户 |

合计：8 个 tab 文件 + admin/index.js 233 行 = 1316 行（v77 admin/index.js 单文件 1137 行）。代码量略增是因为每个 tab 文件头部加了文档注释 + 完整 import。

## 拆分约定

每个 tab 文件统一导出 `async function render(loadActive)`：

```js
import { ..., refreshStats, canHandleTicket } from '../shared.js';
import { $ } from '../../core.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ ... }, () => loadActive());  // refresh 回调注入
  // ... 表格 / 弹窗 / 提交流程
}
```

admin/index.js 的 `loadActive` 通过参数注入到 tab 文件。这样：

- tab 文件**不直接 import admin/index.js**，避免循环依赖
- 工具层（refreshStats / toolbar / table / params）在 shared.js，tab 文件直接引用
- tab 文件使用 `loadActive` 参数调用 `refreshStats(loadActive)` 而不是 `refreshStats(switchTab)`

## 验证

- npm test：**185/186**（唯一失败：copy-lock，admin.js 重写导致 hash 变化）
- module link：**173 JS module / 12 HTML 全部通过**
- 动态 import 全部 tab 文件：`render=function` × 8
- 用户本地操作，未推送未部署

## 下一轮（v79）

1. js/app/state.js（轻量全局 store）
2. 拆 js/app/ 其它 34 个模块到子目录（home/hotel/profile/messages/admin-v37/admin-owner 等）
3. 每个页面重新设计工作区（workspace.js）

## 文件变更清单

- 新增：js/app/admin/state.js, shared.js, index.js
- 修改：js/app/admin.js（521 行 → 14 行 forwarder）
- 新增：REWRITE-V77.md（本文件）
- 未改动：HTML 模板、CSS 源、其它 js/app/ 模块、后端、AGENTS.md

## 风险点

1. shared.js 注入的 `_router` 是 module-singleton，如果未来 admin 页有多个
   实例（iframe / portal）会冲突。当前架构是单实例，无需处理。
2. tab 函数内联在 index.js，未来拆 tabs/ 时要小心 tickets/dispatch 共享
   状态（`adminNames` Map、`dispatching` 标志）。
3. COPY_LOCK 失败需要在 v78 同步处理，否则 deploy 阻塞。