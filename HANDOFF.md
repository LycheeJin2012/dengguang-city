# HANDOFF — 灯光市 dengguang-city 任务交接

> **最后更新**: 2026-09-08 (N6-40 ~ N6-63 commit 全部已推送)
> **接收方**: 任何接续工作的 AI agent
> **项目**: 金礼知 (昵称"荔枝"，九年级) 的 Minecraft 像素城市官方网站「灯光市人民政府」

---

## 🎯 一句话目标

继续完善「灯光市人民政府」网站（静态前端 + Cloudflare Pages Functions + D1），**系统性修 bug + 全 i18n 化 + 探索新功能**。完整项目背景见 [AGENTS.md](./AGENTS.md)。

---

## 📊 当前状态 (截止 2026-09-08)

### 总体进度
- ✅ **24 个 commit** (N6-40 ~ N6-63) 全部已推送到 `https://github.com/LycheeJin2012/dengguang-city`
- ✅ **8 个高危 bug** 全部修复 (用户日常操作 100% 命中的)
- ✅ **~100+ 处硬编码中文** 全部 i18n 化
- ✅ **i18n DICT** 从 432 key 扩到 **~520 key**
- ✅ **全部 commit 已通过 `node --check` 自验** (admin.js / home/forms.js / home/auth.js / home/keyboard.js / admin/core.js 等)

### 关键文件状态
| 文件 | 状态 | 备注 |
|------|------|------|
| `js/admin.js` | ✅ i18n 完整 | 登录 + 二次密码 modal + admin passkey 全流程 |
| `js/admin/core.js` | ✅ STATUS_LABEL 等改 Proxy 化 | i18n 自动生效, 调用方语法不变 |
| `js/admin/dash.js` | ✅ `_PANE_REFRESH` map 修复 | 刷新按钮用 dynamic import |
| `js/admin/tabs/*.js` | ✅ i18n 完整 | tickets / players / kart / circuit / gallery / dms / announcements / admins / passkey 9 个文件 |
| `js/home/auth.js` | ✅ i18n 完整 + t() shadow 修复 | 登录注册 + passkey + 引导 toast |
| `js/home/header.js` | ✅ i18n 完整 | 顶栏 nav 链接 |
| `js/home/forms.js` | ✅ i18n 完整 + 4 处 t() shadow 修复 | 留言/赛车/驾照/酒店 |
| `js/home/signin.js` | ✅ i18n 完整 | 每日签到 modal |
| `js/home/keyboard.js` | ✅ i18n 完整 | 键盘快捷键帮助 modal |
| `js/home/messages.js` | ✅ i18n 完整 | 留言墙 + 评论 |
| `js/i18n/core.js` | ✅ DICT ~520 key | Proxy 化的常量不计入 key count |
| `js/page/dm/entry.js` + `list.js` + `thread.js` | ✅ i18n 完整 | |
| `js/page/profile/info.js` | ✅ i18n 完整 | 编辑个人主页 modal |
| `js/page/profile/citizen-card.js` | ✅ i18n 完整 | 市民身份卡 SVG 模板 |
| `js/page/util.js` + `js/home/util.js` | ✅ i18n 完整 | sub-page nav |

### 已知未修
- ❌ **`messages.type` 字段值 (建议/投诉/咨询/合作) 在 DB 里** 是中文 — 英文页留言类型显示成中文。要改需后端 schema 升级
- ❌ **`auth.js` 几个老警告文案** (Line 81-103 的 bindMessageSubmit 老账号提示) 还有少量中文, 优先级低
- ❌ **`getBundle()` 没有 force-reload 在语言切换时** — `home/forms.js` 的 `lc:langchange` 监听只重拉 `loadRooms()`, 房间状态 label 跟语言走; 房型名/价格是 DB 数据, 保留中文 (跟酒店名一样是数据)

### 未验证的运行时场景 (用户没回执)
- [ ] 玩家登录 admin 后跑 8 tab 验 (用户没回执, AGENTS.md 写了的待办)
- [ ] 英文模式切换全程 (已 i18n 但没逐页确认)
- [ ] admin 公告 CSV 导出 (N6-36 改的, 没真测)

---

## 🚨 核心问题排查清单 (新 AI 接手时必看)

### 1. **i18n 函数名 `t` shadow 是项目最高频 bug**
本项目踩了 4 次同一个坑: `t()` 跟任何 1-2 字符变量名都会撞。每次改完必须 `grep -nE "(\\.map|filter|forEach|find|reduce|some|every|flatMap)\\(.*\\bt\\b\\s*=>" js/` 检查。

**修法**: 局部变量改名 (`tracks.map(tr => ...)` 而不是 `t`)

### 2. **CF Pages Functions 是目录式路由**
`/api/exam-questions/answer` 不会 fallback 到父 `exam-questions.js` 的 path.endsWith 判断, 必须建独立 `functions/api/exam-questions/answer.js` 文件。

### 3. **macOS Tahoe + homebrew node code-signing 坑**
`brew install node` 出来的二进制启动瞬间被 SIGKILL。**永远用** `~/.local/node-v20.19.0-darwin-arm64/bin/node` (用户本地的官方 tarball)。

### 4. **GitHub push 网络间歇断**
重试 2-3 次。如果要触发 CF Pages build, 必须 `git commit --allow-empty -m "trigger build" && git push`。

### 5. **5 页面共享 pwa.js**
不要在每个 HTML 都 inline PWA 注册, js/pwa.js 动态注入 manifest + theme-color + SW。

---

## 🛠️ 接续工作的标准操作

### 检查是否还有未提交
```bash
cd "/Users/Lychee Jin/Desktop/网页制作/dengguang-city-git"
git status --short
```

### 跑 i18n 测试
```bash
~/.local/node-v20.19.0-darwin-arm64/bin/node js/i18n/core.test.js
```

### 跑 syntax check
```bash
~/.local/node-v20.19.0-darwin-arm64/bin/node --check <file.js>
```

### 找 i18n key 缺失
```bash
# 提取所有 t() 调用
grep -hoE "t\(\s*'[a-zA-Z][a-zA-Z._0-9]+'" js/**/*.js js/*.js 2>/dev/null \
  | sed "s/t('//;s/'$//" | grep -E '^[a-z]+\.[a-z]' | sort -u > /tmp/used.txt

# 提取所有 i18n key 定义
grep -oE "'[a-zA-Z][a-zA-Z._]+':" js/i18n/core.js | tr -d "':" | sort -u > /tmp/def.txt

# 找缺失
comm -23 /tmp/used.txt /tmp/def.txt
```

### 找硬编码中文 (但不在 t() fallback 里)
```bash
grep -nE "['\"][^'\"]*[\u4e00-\u9fff][^'\"]*['\"]" js/file.js \
  | grep -v "//\|/\*\|t(['\"]" | head -20
```

### Commit + push 标准流程
```bash
git add -A
git commit -m "N6-NN: 简短描述做了什么"
git pull --rebase origin main  # 先 rebase 防止 non-fast-forward
git push origin main
```

---

## 📋 用户的工作偏好 (重要)

金礼知 (荔枝) 的具体约定 (在 AGENTS.md 也写了):
- ❌ **不擅自装第三方软件** — `brew install` / `pip install` / `npm install` 都要先问
- ✅ **代码交付前先自验** — `node --check` / curl / browser 实拍至少一项
- ✅ **"先 X 再 Y" 分步** — 做完 X 等用户确认再做 Y (不是一次全做完)
- ✅ **截图报错** — 用户会发截图/控制台错误, 直接对着截图修
- ❌ **不要装字体** — 用户之前明确说过"不要装第三方软件"
- ✅ **macOS Tahoe 用户**, 知道 homebrew node code signing 坑
- ✅ **GitHub push 网络间歇断**, 重试即可

---

## 🆘 下次接手可以做什么 (具体任务池)

### 高优先 — 用户可能很快发现
1. **测试英文模式全站切换** — i18n 完整化了但没逐页验证英文模式 UX
2. **admin 玩家登录后跑 8 tab 验** — `cloud browser auth_user_takeover` 阻止代登, 只能等用户实测
3. **看用户截图/控制台错误** — 用户会主动报具体 bug

### 中优先 — 主动优化
4. **`auth.js` 几个老警告文案 i18n** (Line 81-103 的老账号提示)
5. **`messages.type` 字段中文化** — 后端 schema 升级 (需要新 API 版本, 改动大, 跟用户确认再上)
6. **`getBundle()` 在切语言时强制 force=true** — 让房型名/价格跟语言 (但要先确认是否 DB 里存的就是中文名)

### 低优先 — 新功能探索
7. **AI 客服 fine-tune** (AGENTS.md 里写了进度, 需要 .dev.vars + scripts/export-finetune-data.mjs)
8. **admin 工单 SLA 提醒** (超时未处理自动 +1 红点)
9. **首页 City Stats 实时更新** (现在用 /api/homepage-bundle 30s TTL, 实际应该用 WebSocket 推)
10. **PWA offline 留言草稿** (现在断网留言会失败, 应该有 IndexedDB 草稿)

---

## 📁 关键文件位置速查

```
/Users/Lychee Jin/Desktop/网页制作/dengguang-city-git/
├── AGENTS.md              # 项目完整背景 (本目录必备)
├── HANDOFF.md             # 本文件: 任务交接
├── manifest.json          # PWA 配置
├── sw.js                  # Service Worker
├── sitemap.xml            # SEO
├── robots.txt
├── index.html             # 主页 (37KB, 最大)
├── hotel.html             # 树上酒店预订
├── profile.html           # 玩家主页
├── dm.html                # 私信
├── leaderboard.html       # 玩家榜单
├── notifications.html     # 通知中心
├── admin.html             # 跳转页 → admin-v37.html
├── admin-v37.html         # 后台
├── 404.html               # 像素风 404
├── js/
│   ├── i18n/core.js       # DICT + t() (520 key)
│   ├── i18n/core.test.js  # 测试
│   ├── home/              # 主页模块 11 个文件
│   ├── page/              # 4 sub-page 模块
│   ├── admin/             # 后台 9 个 tab + core + dash
│   └── main.js            # 主页入口
├── functions/
│   ├── api/               # 公开端点 15 个
│   ├── api/admin/         # 后台端点 9 个
│   ├── api/actions/       # init.js 委托的 actions
│   └── _shared/           # auth/session/tickets/validators/webauthn/ai/http
└── css/style.min.css      # 单文件合并的 204KB CSS
```

---

## 🧪 验证清单 (完成任何修改后跑一遍)

1. [ ] `node --check` 你改的所有 .js
2. [ ] `node js/i18n/core.test.js` 6 个测试 100% 过
3. [ ] `git status` 没有 untracked
4. [ ] `git log --oneline -5` 确认你的 commit 在
5. [ ] `git push` 后等 30s 看 CF Pages 部署成功
6. [ ] 用浏览器清缓存 (Cmd+Shift+R) 验证改的页面

---

## 💡 接续工作的建议 SOP

1. **每次开新工作前先看** `git log --oneline -10` + `git status`
2. **看用户的 issue/截图** — 他们会明确指出问题, 不要猜
3. **找 bug 的优先级**:
   - 高: 用户日常操作 100% 命中 (刷新崩/登录崩/提交崩)
   - 中: 特定场景 (切语言/特定 tab)
   - 低: i18n 体验/视觉细节
4. **改完别忘跑** `node --check` (用户要求"代码相关问题, 减少 bug")
5. **commit message 用** `N6-NN: 简短描述做了什么`

---

**最后**: 如果用户没回执/没报错, 不要"主动找活干"做完又 push — 容易被认为做了不该做的。**等具体指令**。

> 用户的核心原则: "代码相关问题, 减少逻辑或代码 bug" — 你交付的代码必须先自验
