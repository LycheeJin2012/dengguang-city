# 前端回归审查报告（js/ + css/）

- **审查范围**：`js/`、`css/`、`*.html`、`tests/`、`scripts/build.mjs`（后端 `functions/` 未触碰）
- **基线**：`06e9595` → **HEAD**：`70a5520`
- **性质**：只读审查。未修改任何生产代码；构建产物已跑过且 `git diff` 为空，未留下改动。
- **Node**：`~/.local/node-v20.19.0-darwin-arm64/bin/node` v20.19.0（Homebrew node 未使用）

## 结论摘要

必查 7 项中 **6 项干净**（含大小写、循环依赖、未定义引用、死代码、export 名单、CSS 断层）。
发现 **1 个真实缺陷**（样式错乱，非白屏）和 **3 个低危/守门缺口**。
无白屏级或功能完全不可用级问题。

| # | 严重性 | 问题 | 判定依据 |
|---|--------|------|----------|
| 1 | **高 · 样式错乱** | 浮窗灯灯的 shadow DOM 样式表锁死在 `?v=84` | 静态确认 + CSS 差分确认 |
| 2 | 中 · 守门缺口 | 版本号守门测试只扫 HTML，看不见 `js/` 里的硬编码 | 读测试源码确认 |
| 3 | 中 · 守门缺口 | 等价性测试基线选在重构中途，私信拆分本身未被守门 | `git merge-base` 确认 |
| 4 | 低 · 代码质量 | `admin/tabs/times.js` 自引用 import | 加载实测通过 |
| 5 | 低 · 代码质量 | `core.js ↔ security.js` 动态循环依赖 | 实测无害 |

---

## 1. 【高】浮窗灯灯永远拿 v84 样式，与全站 v89 视觉不一致

- **文件:行号**：`js/ui/assistant-window.js:7`
- **类型**：资源版本号漂移（必查项 7）+ 样式错乱
- **代码片段**：
  ```js
  const shadow=panel.querySelector('.assistant-window-content').attachShadow({mode:'open'});
  shadow.innerHTML='<link rel="stylesheet" href="/css/style.css?v=84"><div class="assistant-embedded"></div>';
  ```
- **触发条件**：打开任意页面 → 点右下角「🤖 灯灯」浮窗。无需登录即可复现（浮窗外壳先渲染，登录态在 `content()` 里等）。
- **实际影响**：
  - 该浮窗是 **Shadow DOM**，样式不继承宿主文档，只认自己 `<link>` 里那条 URL。`/css/style.css?v=84` 与 `?v=89` 是**两个独立缓存键**，浏览器会分别缓存/下载。
  - 访客在本轮改动前打开过站点的，命中旧 `v84` 缓存 → 浮窗按 v84 渲染；没打开过的 → 拿新 CSS。**同一版本不同用户看到两种外观。**
  - 实测 CSS 差分（`git show 37dde0a:css/style.css` vs 当前）确认受影响规则确实变了：

    | 选择器 | v84（浮窗会拿到的） | HEAD v89（全站其余部分） |
    |---|---|---|
    | `.bubble.mine` | `background:var(--leaf-soft)` 浅绿底 | `background:var(--green-deep);color:var(--paper)` 深绿底反白 |
    | `.bubble` | `border:var(--border-thin)` | `border:3px solid var(--line);box-shadow:4px 4px 0` |
    | `.conversation` | 无边框，`border-bottom:1px solid` | 3px 黑边 + 3px 3px 硬投影，像素卡片 |
    | `.messages` | `background:var(--paper-soft);border:1px` | `background:var(--paper-2);border:3px solid` |
    | `.chat-assistance` | `border-left:4px solid` | `3px` 边 + `4px 4px 0` 投影 |

  - 即：浮窗里自己的气泡是浅绿底、消息区无硬边、会话列表是下划线列表，而同一屏主页面是像素硬边风格。v88.6 重做的 `chat.css` 里 `.assistant-embedded` 那 7 条紧凑布局规则在 v84 里**根本不存在**。
- **实跑复现还是静态推断**：**静态确认**。文件内容、git 引入历史（`git log -L 7,7`）、v84↔HEAD 的 CSS 差分三处交叉验证。本机无浏览器，未做像素级实跑；但机制是确定性的（不同 URL = 不同缓存键），不依赖环境。
- **置信度**：**高**
- **根因**：`fbaed1a`（"资源版本号解冻"）把 12 个 HTML 从 v85→v89，但漏掉了 `js/` 内部这一处。该值上次更新是 `37dde0a`（v76 的 76→84）。
- **建议**：改为 `?v=89`，或按 `build.mjs` 统一注入（勿手工 bump）。

## 2. 【中】版本号守门测试结构上抓不到 #1

- **文件:行号**：`tests/asset-version.test.js:23`
- **类型**：守门测试覆盖缺口
- **代码片段**：
  ```js
  const HTML = readdirSync('.').filter((f) => f.endsWith('.html'));
  ```
- **实际影响**：4 条断言全部只遍历根目录 `*.html`。`js/ui/assistant-window.js` 里的 `?v=84` 对测试**完全不可见**——这正是它能一路存活、且在 237 个测试全绿的情况下仍然存在的原因。测试注释里写的正是「部署后浏览器会吃旧缓存」，而唯一的实例恰好在扫描范围之外。
- **实跑复现还是静态推断**：静态确认（读测试源码 + `grep -rn '?v=[0-9]' js/ css/ sw.js manifest.json`，全仓仅此一处命中）。
- **置信度**：高

## 3. 【中】等价性守门测试的基线选在重构中途，私信拆分本身没被守住

- **文件:行号**：`tests/refactor-equiv.test.js:30`（`const BASELINE = '1654447'`）
- **类型**：守门测试覆盖缺口
- **实际影响**：`1654447` 正是 v88.6 的**第一个**前端提交（"私信拆模块 + 像素化重做 + 独立 chat.css"），且位于 `06e9595` **之后**（`git merge-base --is-ancestor` 确认）。因此该测试只能守住 `1654447..HEAD` 的后续 5 个提交，**恰好漏掉本次审查最需要守的私信 6 模块拆分和新建 `chat.css` 的那个提交**。测试标题还写着"重构前的基线提交"，与实际语义不符。
- **实跑复现还是静态推断**：静态确认（git 祖先关系 + 提交标题）。
- **置信度**：高
- **缓解**：该缺口已由本报告的第 1/2/4/5 项检查人工补上（228 个 import 全部存在且大小写一致、全站 87 个模块可加载、11 个 `data-page` 全部启动成功、export 名单无缺失）。

## 4. 【低】`admin/tabs/times.js` 导入自身

- **文件:行号**：`js/app/admin/tabs/times.js:18`
- **代码片段**：`import { render as renderSelf } from './times.js';`
- **触发条件**：后台「成绩审核」页 → 点列表行「改认证方式」。
- **实际影响**：无功能影响。`renderSelf` 就是本文件的 `render`，属自递归间接调用；ESM 自引用合法且函数声明已提升。**非 v88.6 引入**，文件注释已写明"这是原代码的写法，本次保持原样"。
- **实跑复现还是静态推断**：静态确认 + 该模块在本报告的全站加载实测中通过。
- **置信度**：高（判定为无缺陷，仅记录）

## 5. 【低】`core.js ↔ security.js` 循环依赖（动态）

- **文件:行号**：`js/app/core.js:293` → `js/app/security.js`（`security.js` 再静态 import `core.js`）
- **实际影响**：无。动态 `import()` 写在点击处理函数内部，触发时 `core.js` 已完全求值完毕，不存在 TDZ 问题。全站加载实测无报错。
- **实跑复现还是静态推断**：静态确认 + 加载实测。
- **置信度**：高（判定为无缺陷，仅记录）

---

## 逐项核查明细（附方法与证据）

| 必查项 | 方法 | 结果 |
|---|---|---|
| 1. 模块拆分遗漏 | 用 `git ls-files` 取**精确大小写**的文件名集合，对 87 个文件里 **228 条相对 import** 逐条 `normalize` + 精确匹配；同时对全项目导入图找环 | ✅ 0 问题。0 条大小写不符（macOS 不敏感也验了，走的是 git 索引的真实大小写）。静态环仅 `times.js` 自引用（第 4 项）。其余"自环"经复核是**注释里**的 `import('./x.js')` 被正则误捕 |
| 2. 未定义引用 | 自写作用域分析（import 名单 + 全文件声明并集 vs 被调用标识符），再在 Node 里用最小 DOM stub **真实 import 全部 87 个模块** | ✅ 0 问题。分析器初版因先剥字符串导致 import 名单全空（大量误报），已修正；剩余 18 条全部人工复核为解构参数 / DI 注入 / 动态 import 解构（`js/ui/dialog.js` 的 `$`/`$$`/`esc` 来自 `openDialog(deps,…)`，`format` 是列描述符回调） |
| 3. 死代码 / 空函数体 | 与 `06e9595` 做**全项目函数名并集**差分 + 逐文件空块扫描（行号取原始源码） | ✅ 0 问题。`js/` 总行数 **4656 → 9888**（只增不减）。并集里"消失"的 3 个名字是纯改名：`updateFeedback`→`updateReplyFeedback`、`poll`→`schedulePoll`、`links`→`sourceLinks`。`attachments.js`(6760→576B) 与 `ticket-form.js`(8279→682B) 的函数减少是搬进 `features/`，转发层 export 名单逐字保留。所有空块均为 `.catch(()=>{})`、`= () => {}` 默认参数、或 `press-motion.js` 的 best-effort 吞异常，无一处逻辑被清空 |
| 4. export 名单丢失 | 对基线 73 个文件逐个 `git show 06e9595:` 对比 `export` 名集合 | ✅ 0 缺失。唯一 2 处差异（`attachments.js` / `ticket-form.js`）是 `export function` 改写成 `export {}` 再导出，名字完全相同。**0 个文件被删除**，新增 14 个 `features/*` 模块 |
| 5. 事件监听器丢失 | 基线 `chat/index.js` vs HEAD `chat/*.js` 绑定数对比 + 全站监听点排查 | ✅ 0 丢失。`addEventListener` 0→0，`.on*` 赋值 10→10。全站**无** `DOMContentLoaded` 依赖——`entry.js` 由 `type="module"` 加载，浏览器保证延迟到 DOM 解析完成，`shell()` 同步调用是安全的 |
| 6. CSS 断层 | 跑 `scripts/build.mjs` 后 `git status`；再把 6 个 `css/source/*.css` 的**每条选择器**（去注释后）逐条在 `style.css` / `style.min.css` 里查找 | ✅ 0 断层。构建后 `git diff` **完全为空**（产物与入库一致，可复现）。478 条规则 100% 命中，`chat.css` 的 59 条全部在编译产物内，`chat` 已在 `build.mjs:7` 的 `styleParts` 清单里。`style.css` 与 `style.min.css` 字节相同 |
| 7. 资源版本号 | 全仓 `grep -rn '?v=[0-9]'` + 与 `build.mjs` 期望比对 | ⚠️ **发现缺陷 #1**。12 个 HTML 共 23 处引用全部为 `?v=89`，无一处 84；`js/` 内 1 处为 `?v=84` |

### 补充：路由与启动实测

用最小 DOM stub 真实执行 `entry.js` 的完整启动路径，**11 个 `data-page` 全部 BOOT OK**（home / hotel / hotel-owner / map / affairs / messages / dm / notifications / knowledge / profile / admin）。`PAGES` 路由表键与各 HTML 的 `data-page` 完全对应，无缺失键（缺失会导致 `PAGES[page]()` 抛 TypeError 白屏）。`admin.html` 无 `<script>` 属正常——它是 `meta refresh` 跳转桩，实体在 `admin-v37.html`。

### 测试与构建执行记录

- `"$NODE" --experimental-vm-modules --test tests/*.test.js` → **237 passed / 0 failed**（含 `refactor-equiv`、`asset-version`、`visual-language`、`frontend`）
- `"$NODE" --experimental-vm-modules scripts/build.mjs` → `Build validated: 205 JS modules, 12 HTML pages`，**`git status` 无 tracked 变更**

## 未验证 / 环境边界

- **浏览器像素级渲染未实跑**（本机无浏览器自动化环境）。#1 的样式差异由 CSS 源码差分 + 缓存键机制推定，机制确定性高，但未做视觉截图确认。
- **未联网**：线上仍是 v84，本轮未部署，按要求未做线上验证。
- 后端 `functions/`、`wrangler`、`.dev.vars` 未触碰。

## 备注

仓库根目录存在若干**其他 agent 的**未跟踪临时文件（`.audit-*.mjs`、`.vfy-*`、`.chg.tmp`、`.vfy-scratch/` 等）。非本审查产出，已原样保留未清理。
