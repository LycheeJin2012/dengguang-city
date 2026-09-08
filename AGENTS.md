# AGENTS.md — dengguang-city 项目备忘

> 这是金礼知（昵称"荔枝"，九年级）的 Minecraft 像素城市官方网站「灯光市人民政府」
> GitHub: `LycheeJin2012/dengguang-city` · Cloudflare Pages: `dengguang-city.pages.dev`
> 工作目录: `/Users/Lychee Jin/Desktop/网页制作/dengguang-city-git/`

## 项目结构
- 静态前端: `index.html` / `hotel.html` / `profile.html` / `dm.html` / `admin-v37.html`
- 共享 CSS: `css/style.css` (单文件 v49 合并)
- JS: `js/main.js` (主页入口) + `js/home/*` (主页模块) + `js/page/{hotel,profile,dm}/*` (子页) + `js/admin/*` (后台) + `js/i18n/*` (N5 国际化)
- Functions (D1 绑定名 `DB`): `functions/api/*` (公开端点) + `functions/api/admin/*` (后台专属) + `functions/api/actions/*` (init.js 委托 actions)
- 共享 utils: `functions/_shared/*` (auth / session / tickets / validators / webauthn / ai / http)
- D1 database_id: `8014f3c2-e578-4e7d-8c54-c37c3b28f401`

## 已修的真 bug (v50 修复轮, 8 个 fix-9~15 + 15 个 N4/N5)
- `fix-9` hotel 房型 0 间 → 3 间 (rooms.js 改用 /api/homepage-bundle)
- `fix-10` index.html nav 重复"国际赛车场"+ dead"市政厅"链接
- `fix-11` /api/exam-questions/answer 返 405 (CF Pages 目录路由)
- `fix-12` 主页 hotel 预览 + bookings API 都拒草稿酒店
- `fix-13` admin-v37 pwdForm + loginForm 补 JS submit handler
- `fix-14` hotel.html "草案草案" 重文
- `fix-15` PWA SW 加 admin-v37 + 字体/JS/背景图缓存
- `fix-16` data-card "17 注册市民" 硬编码 → 动态拉
- `fix-18` animateNumber -1 异常值防御
- `fix-19/20` data-card + hero 直接设值 (避免 rAF 节流)
- **v50-N6 B6-extend**: CSS minify 237→204KB + admin 工单/玩家管理 i18n
- **v50-N6 B6-extend**: 主页全表单中英（留言/赛车/驾照/酒店预订/客房卡片）
- **v50-N6 B6-extend**: profile/dm/notifications/leaderboard/留言墙 全链路 i18n
- **v50-N6 C1**: 玩家排行榜（messages/bookings/licenses 3 维度）
- **v50-N6 C2**: 通知中心页 + nav 入口

## 已实现新功能
- **N4 通知** (admin reply → 玩家铃铛红点): functions/api/admin/messages.js PATCH 写 notification_log + js/page/util.js + js/home/header.js 加 🔔 铃铛 + profile 进 my-messages 自动 PATCH read-all
- **N5 i18n** (中英双语 11 步):
  - js/i18n/core.js: DICT 词典 (259 key) + t/tf/setLang/setPageTitle/setMetaDescription + localStorage 持久化 + lc:langchange 事件 + _onLangChangeOnce 防泄漏
  - 5 页面 init: index.html (主页 nav + placeholder) / hotel.html (nav + filter + modals + count) / profile.html (5 card 标题) / dm.html (加载/空态/错误) / admin-v37 (8 tab 标签)
  - 11 维度: nav / filter / count / modals / loading / empty / error / page title / placeholder / meta description / 切换器按钮文字动态
  - js/i18n/core.test.js: Node 内置 test runner, 6 个测试 100% 过 (DICT 完整性 + HTML 引用 + JS 调用 + 命名空间一致性)
  - package.json: 'npm test' script

## 关键架构决策 (不要再改)
1. **CF Pages Functions 路由是目录式**: `/api/exam-questions/answer` 必须有 `functions/api/exam-questions/answer.js` 文件，不能依赖父 `exam-questions.js` 的 `path.endsWith('/answer')` 内部路由 (CF Pages 会去找 answer.js 找不到就 405)
2. **homepage-bundle.js 不过滤 is_active**: 所有数据可见; init.js action=homepage-bundle 过滤 is_active=1 (公开端点保留两种语义)
3. **DB schema 都用 is_active (0/1) 不用 status 字符串**: rooms table 没用 "草拟/筹建/拟建" 列, 只有 is_active. 页面 status 字符串是 JS 映射, 跟 schema 解耦
4. **CSS 合并在 css/style.css 单文件**: 不要拆, 移动端响应式都靠 flex-wrap
5. **CF Pages 不触发 webhook on force push**: 必须 empty commit + push 才能 build

## 端点权限矩阵
- 公开 (200 无 session): `/api/homepage-bundle` `/api/announcements` `/api/gallery` `/api/comments?message_id=X` `/api/messages?public=1` `/api/exam-questions?grade=X` `/api/race-times?track_id=X` `/api/login` (返未登录) `/api/init?action=signin-status` `/api/init?action=unread-summary` (返 logged_in:false)
- 玩家 (需 player session): `/api/messages?my=1` `/api/circuit` `/api/kart` `/api/bookings` `/api/license` `/api/notifications?my=1` `/api/exam-questions/answer` `/api/race-times?my=1` `/api/social?action=dm-*` `/api/subscriptions?my=1`
- Admin (需 admin session): `/api/admin/*` `/api/init?action=hotels-manage|hotel-rooms-manage|race-tracks-manage|license-req-manage` + admin tab 8 个 (tickets/players/kart/announcements/gallery/dms/admins/password)
- 全匿名 (401): `/api/messages` POST (留言需玩家) `/api/comments` POST/DELETE (需 player 或 admin) `/api/init?action=announcement-*|admin-*|passkey-*`

## PWA 配置
- `manifest.json` + `sw.js` + `js/pwa.js` (5 页面引用) + `assets/icons/icon.svg`
- SW CACHE_VERSION: 'lc-v50-2026-09-07-v20' (bump 触发 activate 清旧 cache)
- STATIC_ASSETS 缓存: 7 HTML + style.css + fonts.css + theme.js + toast.js + pwa.js + manifest + icon + 2 woff2 + bg-pixel-hero.jpg + track-placeholder.svg
- 策略: navigation network-first 回退 cache → /; 静态资源 cache-first + 后台 stale-while-revalidate

## 已知遗留 / 待你验证
- 玩家登录 admin 跑 8 tab 验 (cloud browser auth_user_takeover 阻止代登)
- **AI fine-tune 进度**:
  - ✅ .dev.vars 加 OpenAI key (key 不 commit, .gitignore 拦了真 .dev.vars)
  - ✅ scripts/export-finetune-data.mjs (拉 D1 留言+回复 → JSONL, 你登录后跑)
  - ⏳ 生产 env 设 (CF Dashboard 或 wrangler secret put, 待你确认方法)
  - ⏳ 数据量评估 (现在只有 4 条, OpenAI 推 50+, 可能要等更多)
  - ⏳ fine-tune job (openai CLI, 需你确认模型 + budget)

## v50-N6 i18n 完善 (24 个 commit, 2026-09-07)
> 系统化做完整站中英双语化, 同步加键盘快捷键 / SEO / 角标 / 排序 等 UX 升级

### DICT: 286 → 432 key (+146 个新 key)
- 主页 nav / 11 section head / 流程 4 步 / footer / hero / top-strip / 公告卡 / 留言墙 / 评论区
- hotel: 状态 / 人数 / 景观 / 排序 / 房型卡 / 详情 modal
- admin: 6 个 tab (tickets/players/kart/circuit/gallery/dms/announcements/admins) + 6 个 stat 卡片 + filter 选项
- 排行榜: 3 tab + label + unit
- 4 个 sub-page (hotel/profile/dm/notifications) 顶 nav
- profile: 加入天数 + 4 档纪念勋章 (铜/银/金/钻石)
- 通用: 加载/错误/空状态/关闭/回到顶部 等

### Bug 修复 (N6)
- `N6-1` 酒店 filter i18n 失效 → 引入 `statusKey` canonical key, 显示用 i18n label
- `N6-2` hotel.html / profile.html 之前 data-i18n 但**没调 initI18n** — 补上
- `N6-3` leaderboard 页 lang toggle 按钮**没绑事件** — 修
- `N6-4` admin 4 个 tab 角标 (kartPending/circuitPending) **永不更新** — 用 /api/admin/dashboard 启动时拉
- `N6-5` admin 公告 tab 列表 2 处残留 (编辑/删除) — i18n
- `N6-6` admin tickets filter (status + category) hardcode — i18n
- `N6-7` forms.js 4 处 (次/级/岁/分钟/级考试/预订) — i18n
- `N6-8` 主页 5 个 service 卡 dead-link (`href="#"`) — 跳留言板 + 预填 type + focus
- `N6-9` 留言/评论/DM 换行被 `escHtml` 吃掉 — 加 `escHtmlBr` (4 处替换)

### 新功能 (N6)
- `N6-10` 主页键盘快捷键 (g/h/n/d/s/b/?) — 像 GitHub 一样快速跳 section
- `N6-11` 主页 5 个 service 卡 dead-link 修复 + 预填 type
- `N6-12` SEO 三件套: robots.txt (屏蔽 GPTBot) + sitemap.xml + Open Graph + Twitter Card
- `N6-13` JSON-LD GovernmentOrganization schema (Google 知识图谱)
- `N6-14` 主页 footer 全 i18n
- `N6-15` admin 顶部 6 个 stat 卡片 (可点击跳 tab)
- `N6-16` hotel 房型 4 档排序 (默认/价格↑↓/容量↓)
- `N6-17` profile "加入天数" stat + 4 档纪念勋章 (7/30/100/365 天, 铜/银/金/钻石)
- `N6-18` hotel intro 段 i18n
- `N6-19` admin 工单 status + category filter 全 i18n
- `N6-20` 城市风 404 页面 (像素风)
- `N6-21` CSS minify (237→204KB, 14% 节省) + SW v20
- `N6-22` data-i18n-aria 属性支持 (a11y 标签 i18n)
- `N6-23` sub-page 顶 nav i18n (4 页共用 renderSubpageNav + injectLangSwitch)
- `N6-24` admin 公告 tab 列表 2 处残留 i18n

### i18n 基础设施
- `js/i18n/core.js` — DICT + t() + setLang + setPageTitle + setMetaDescription + applyToDOM
- 4 种 data-i18n-* 属性: textContent / title / placeholder / aria-label
- 6 种语言切换方式: 主页 nav 按钮 / 4 sub-page injectLangSwitch / 排行榜 langToggle / 通知 langToggle / localStorage 持久化 / lc:langchange 自定义事件
- 工厂模式: STATUS_LABEL / getCatLabel() / getStatusLabel() 每次 render 取当前语言, 切换自动生效
- canonical key + label 模式: filter/比较用 key (永不变), 显示用 i18n label (跟语言走)
- **Proxy 模式** (新, N6-48): admin/core.js 的 STATUS_LABEL / EXAM_LABEL / EXAM_BADGE 是 `new Proxy({}, { get: (_, k) => t('admin.statusLabel.' + k) })` — 调用方 `STATUS_LABEL[key]` 语法不变, 自动走 i18n
- **i18n 函数名 t() 极容易 shadow**: callback/forEach/map/arrow 里 `const t = Xxx` 或 `t` 作为参数, 后面的 `t('key')` 全崩 (会调成 Xxx('key') → TypeError). 修法: 局部变量改名 (`tracks.map(tr => ...)`). **绝不能给 i18n helper 起 1-2 字符短名**

## v50-N7 系统性 bug 扫描 + i18n 完整化 (2026-09-07, 24 个 commit N6-40~N6-63)
> 用户说"点完刷新然后会崩"截图 → 修出 8 个高危 bug, 顺便把全站 100+ 处硬编码中文全 i18n 化

### 8 个高危 bug (N6-40 ~ N6-42)
| # | 位置 | 现象 | 根因 | 修法 |
|---|------|------|------|------|
| 1 | `js/admin.js:265` + `js/admin/dash.js:52` | 刷新按钮 → `Can't find variable: renderDms` | `eval(target+ '()')` / `new Function('return '+target)()` 找不到 ES module 导出 | 改 dynamic import 查表 (dash.js 加 `_PANE_REFRESH` map, export 后给 admin.js 用) |
| 2 | `js/admin.js:243` (change handler) | 切 filter → `m.renderTab is not a function` | v47 遗留死代码 + map 里 messages/bookings/license 已删 | 删整个 handler, bindFilterRadios 接管 |
| 3 | `js/admin/dash.js:36-40` (`_FILTER_RENDER`) | 切 filter 没反应 | key 是 `players/circuit_kart/kart_circuit`, radio name 去掉 Filter 后是 `player/kart/circuit` — 全部 miss | 改 key 为 `player/kart/circuit` |
| 4 | `js/admin/tabs/kart.js:104` | 编辑赛道报名 modal 崩 `_KIND_LABEL is not defined` | 实际是函数 `_kindLabel(kind)`, 写成大写对象 `_KIND_LABEL[kind]` | 改回函数调用 + 加 i18n key `admin.kart.editTitle` |
| 5 | `js/page/hotel/rooms.js:146` | 房型详情按钮崩 `m.openRoomDetail is not a function` | `openRoomDetail` 在 rooms.js 自己, 却通过 dynamic import book.js 调它 | detail 走本文件, book 按钮才走 dynamic import |
| 6 | `js/home/forms.js:141` | 国际赛车场报名 → 崩 | `tracks.map(t => ...)` 内 `${t('common.perTrial')}` 实际是 `trackObj('common.perTrial')` → TypeError | 局部变量改 `tr` |
| 7 | `js/home/forms.js:546` | `loadKartSpecs` 崩首页赛车场区 | `const t = tracks[0]` shadow 外层 i18n t() | 改 `const tr = tracks[0]` |
| 8 | `js/page/profile/race-times.js:75` | 玩家上报圈速时选 track 但 time 格式不对 → 崩 | `const t = parseTimeStr(timeStr)` shadow | 改 `const ms = parseTimeStr(...)` |

### i18n 化 (N6-43 ~ N6-63, ~100+ 处)
- **admin tabs 全套** (N6-43, N6-48, N6-50, N6-51, N6-63): tickets / players / kart / admins 全部 prompt/confirm/toast 加 fallback + i18n 化
- **admin core** (N6-48): STATUS_LABEL/EXAM_LABEL/EXAM_BADGE 改 Proxy 自动走 i18n, safeRender / fileToDataURLP 错误文案 i18n
- **admin.js 总入口** (N6-62): 登录页 + 二次密码 modal + admin passkey 全流程 30+ 处 i18n
- **home/auth.js** (N6-49, N6-52, N6-53): 登录注册 + passkey 完整流程 18+12 处 i18n, **t() shadow 修复** (`const t = $('#loginTitle')` 改 `const titleEl = $('#loginTitle')`)
- **home/header.js** (N6-56): 顶栏 nav 链接全 i18n (管理/签到/通知/私信/登出)
- **home/signin.js** (N6-54): 签到 modal 全套 15 处 i18n
- **home/forms.js** (N6-43, N6-44, N6-46, N6-59): 5 处硬编码中文改 i18n
- **page/dm/entry.js** (N6-55): 收件箱 + AI 客服 4 处 i18n
- **page/profile/info.js** (N6-60): 编辑个人主页 modal 8 处 i18n
- **page/profile/citizen-card.js** (N6-58): SVG 模板 5 处 i18n (玩家点"生成我的市民卡")
- **home/keyboard.js** (N6-61): 7 个快捷键描述 + 标题 + 提示 + 关闭按钮 全 i18n

### DICT 状态
- 起始: 432 key (N6-24)
- 当前: **~520 key** (+88 个新 key: admin.enterModal.* / admin.passkey.offer.* / passkey.err.* / auth.err.* / signin.* / kbd.* / citizen.card.* / nav.* / license.* / track.* / spec.* / profile.history.* / profile.citizen.* / profile.editModal.* / dm.* / common.*)
- Proxy 化的 3 个常量 (N6-48) 不算 key, 但调方 `STATUS_LABEL['pending']` 实际查询 `admin.statusLabel.pending`
- 测试: `node js/i18n/core.test.js` 全过 (DICT 完整 + HTML 引用 + JS 调用 + 命名空间一致)

### 这一轮的关键经验
1. **eval/new Function 不能调 module 导出**: 必须用 dynamic import (`import('./tab.js').then(m => m.renderXxx())`)
2. **`m.someMethod()` 必须先确认 method 真的 export**: 否则 `undefined is not a function` 崩
3. **map/filter/forEach callback 里 `t` 参数会 shadow 外层 i18n `t()`** — **这是项目里踩了 4 次的同一个坑**
4. **Proxy 包装常量做 i18n**: 调用方语法 `STATUS_LABEL[key]` 不变, 内部走 t() 翻译
5. **i18n key 永远带 fallback**: 万一 key 缺失, 用户至少看到中文兜底而不是空弹窗 (`t('admin.x.fail', '失败')` 而非 `t('admin.x.fail')`)

## 跟金礼知 (荔枝) 协作约定
- 不擅自装第三方软件 (brew install / pip install / npm install 都要先问)
- 代码交付前先自验 (node --check / curl / browser 实拍 至少一项)
- "先 X 再 Y" 分步 (做完 X 等用户确认再做 Y)
- macOS Tahoe + homebrew node code-signing 坑: 用 `~/.local/node-v20.19.0-darwin-arm64/bin/node` 不用 brew node
- GitHub push 网络间歇断, 重试 2-3 次
- OPENAI_API_KEY 过期: 灯灯 DM 客服已有 fallback, admin AI 草稿也有 fallback (4 种 tone 固定模板)
