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

## 已实现新功能
- **N4 通知** (admin reply → 玩家铃铛红点): functions/api/admin/messages.js PATCH 写 notification_log + js/page/util.js + js/home/header.js 加 🔔 铃铛 + profile 进 my-messages 自动 PATCH read-all
- **N5 i18n** (中英双语 11 步):
  - js/i18n/core.js: DICT 词典 (71 key) + t/tf/setLang/setPageTitle/setMetaDescription + localStorage 持久化 + lc:langchange 事件 + _onLangChangeOnce 防泄漏
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
- SW CACHE_VERSION: 'lc-v50-2026-09-06-v17' (bump 触发 activate 清旧 cache)
- STATIC_ASSETS 缓存: 7 HTML + style.css + fonts.css + theme.js + toast.js + pwa.js + manifest + icon + 2 woff2 + bg-pixel-hero.jpg + track-placeholder.svg
- 策略: navigation network-first 回退 cache → /; 静态资源 cache-first + 后台 stale-while-revalidate

## 已知遗留 / 待你验证
- 玩家登录 admin 跑 8 tab 验 (cloud browser auth_user_takeover 阻止代登)
- N5 Step 6+ 翻译 admin 子表单 / 留言墙 / 赛车场 / 图集等
- **AI fine-tune 进度**:
  - ✅ .dev.vars 加 OpenAI key (key 不 commit, .gitignore 拦了真 .dev.vars)
  - ✅ scripts/export-finetune-data.mjs (拉 D1 留言+回复 → JSONL, 你登录后跑)
  - ⏳ 生产 env 设 (CF Dashboard 或 wrangler secret put, 待你确认方法)
  - ⏳ 数据量评估 (现在只有 4 条, OpenAI 推 50+, 可能要等更多)
  - ⏳ fine-tune job (openai CLI, 需你确认模型 + budget)

## 跟金礼知 (荔枝) 协作约定
- 不擅自装第三方软件 (brew install / pip install / npm install 都要先问)
- 代码交付前先自验 (node --check / curl / browser 实拍 至少一项)
- "先 X 再 Y" 分步 (做完 X 等用户确认再做 Y)
- macOS Tahoe + homebrew node code-signing 坑: 用 `~/.local/node-v20.19.0-darwin-arm64/bin/node` 不用 brew node
- GitHub push 网络间歇断, 重试 2-3 次
- OPENAI_API_KEY 过期: 灯灯 DM 客服已有 fallback, admin AI 草稿也有 fallback (4 种 tone 固定模板)
