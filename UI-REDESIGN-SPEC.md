# 灯光市 UI 规范（v85）

> 本文件是**组件命名的唯一权威来源**。任何改动 `css/source/*.css` 或 `js/ui/*.js`
> 的提交都必须同步本文件；`tests/ui-components.test.js` 与 `tests/layout-retirement.test.js`
> 会按此处的类名做回归断言。

## 0. 语言：纯中文（v85 起）

站点**只有中文**。v85 移除了整套 i18n 机制：

- `core.js` 不再导出 `tr()`，界面文案就是裸中文字符串。
- `state.language`、`localStorage['lc_lang']`、`#language` 切换按钮，以及
  `press-motion.js` 里对应的选择器，全部已删除。
- `title(zh)` 是单参数；页头 eyebrow 固定为品牌常量 `LIGHT CITY`。
- `status()` / `optionLabel()` / `ticketBody()` 的标签表从 `{key:['中文','English']}`
  收敛为 `{key:'中文'}`。
- 后台导航 `admin-navigation.js` 的 `label` 是**字符串**，不是数组。
  v85 在此修过一个真实 bug：`tr(...group.label)` 简化成 `group.label` 之后，
  如果 label 仍是 `['中文','English']`，`textContent` 会渲染成 `中文,English`。

新增界面文案请直接写中文，**不要**再引入 `tr()` 或任何语言切换。

## 0.1 与 v1.0 规范的关系

v1.0 规范描述的类名（`.btn`、`.btn-primary`、`.card-flat`、`.card-pad`、
`.empty-state`、`.tag`、`.pane-head`、`.pane-hint`、`.modal-mask`）**在当前
CSS 中一个都不存在**。v77–v83 的组件重构已把它们全部替换为下表的类名。
照着 v1.0 写代码会得到无样式的裸元素。

本文件按当前真实代码重写，保留 v1.0 的视觉语言约束（第 1 节完全不变）。

## 1. 视觉语言（不变）

- 米色纸感背景 (`--paper`) + 黑色边框 (`--border` / `--border-thin`)
- 像素风等宽字体 (`--font-mono`)
- 偏移阴影 (`--shadow` / `--shadow-soft`)
- 主色仅限：草绿 `--green`、金色 `--gold`、水蓝 `--blue`、红石 `--red`、石头 `--muted`
- 不新增颜色 / 字体 / 图案 / 圆角；圆角一律 0
- 不引入暗色主题或 `prefers-color-scheme` 分支（`tests/frontend.test.js` 会拒绝）

## 2. 组件类名对照表

| 语义 | ✅ 现行类名 | ❌ v1.0 旧名（已废弃） |
| --- | --- | --- |
| 按钮 | `.button`，修饰 `.primary` / `.quiet` / `.danger` / `.compact` | `.btn` `.btn-primary` `.btn-ghost` `.btn-danger` |
| 卡片 | `.card`，修饰 `.compact` / `.spacious` | `.card-flat` `.card-pad` |
| 空状态 | `.empty`，修饰 `.compact` / `.error` | `.empty-state` |
| 标签 | `.badge`，状态 `.active` `.pending` `.rejected` `.closed` | `.tag` `.tag-success` |
| 区块标题 | `.section-head` | `.pane-head` |
| 行内标题 | `.row-head` | — |
| 页面标题 | `.page-heading` + `.eyebrow` | — |
| 说明文字 | `<p class="muted">` / `.form-helper` | `.pane-hint` `.hint` |
| 弹窗 | `<dialog class="modal">` + `.modal-head` + `.modal-body` | `.modal-mask` |
| 表单字段 | `.field`，修饰 `.wide` `.check` `.compact` `.spacious` `.field-error` | — |
| 表格 | `.table-wrap` + `.responsive-table` | — |
| 区块间距 | `.stack-top` / `.stack-top-lg` / `.stack-top-xl` / `.stack-top-2xl` | 内联 `style="margin-top:Npx"` |

## 3. 组件用法

### 按钮
```html
<button class="button primary">主操作</button>   <!-- 或直接 <button class="primary"> -->
<button class="button quiet">次操作</button>
<button class="button danger">危险</button>
<button class="button compact">小号</button>
<button class="icon-button" aria-label="关闭">✕</button>
```

### 卡片
优先用 `js/ui/card.js` 的 `recordCard()`，不要手拼 `<article class="card">`：
```js
recordCard({
  title: r.name,              // 会被 escapeHtml 转义
  meta: '<p class="eyebrow">…</p>',
  body: '<p>…</p>',
  actions: '<button …>操作</button>',
  media: '<img loading="lazy" …>',
  density: 'compact',         // 'compact' | 'spacious'
})
```

### 空状态
```html
<div class="empty"><p>暂无数据</p></div>
```

### 标签
```html
<span class="badge active">已通过</span>
<span class="badge pending">待处理</span>
<span class="badge rejected">已驳回</span>
```

### 弹窗
一律用 `js/ui/dialog.js` 的 `openDialog()` / `core.js` 的 `modal()`，不要手写遮罩层：
```js
modal('标题', content, { wide: true, footer: '<button …>额外操作</button>',
                         submit: async (data, dialog) => { … } })
```

### 表单字段
一律用 `js/ui/form-field.js` 的 `formField()` / `core.js` 的 `field()`：
```js
field('name', '名称', 'text', value, { helper: '提示', required: false })
```

### 表格
```js
tableFrame([tr('时间', 'Time'), '操作者'], rowsHtml, { density: 'compact' })
```

## 4. 页面与模块结构

- `js/ui/*` 是共享组件的**事实来源**，页面适配器不得重复实现。
- `js/app/pages/<page>/index.js` 是每个页面的渲染入口。
- `js/app/*.js` 中除 `entry.js`、`core.js` 等核心文件外，其余均为 v79 的**兼容转发层**，
  每个符号直接 `export … from` 真实模块；**新代码不得再经过转发层**，直接
  `import from '../<workspace>/<module>.js'`。
- 路由统一写在 `js/app/entry.js` 的 `pages` 表里，全部直连 `pages/` 或 `admin/`。
- `js/app/entry.js` 顶部必须先 `installErrorBoundary()`，再执行任何业务逻辑。

## 5. 页面清单（12 个 HTML + 1 个跳转壳）

`index` / `hotel` / `hotel-owner` / `profile` / `affairs` / `knowledge` / `map` /
`messages` / `dm` / `notifications` / `404` / `admin-v37`

`admin.html` 只是跳转到 `admin-v37.html` 的 meta-refresh 壳，不引用样式或脚本。

每个页面的 HTML 是单行 shell（`data-page` 驱动），主体由 `entry.js` 动态渲染，
所以改版必须同时看 HTML shell 和 `js/app/pages/*`。

## 6. 不允许的写法

- 内联 `style="background:…"` / `style="color:…"`；间距改用 `.stack-top*`
  （唯一例外：地图 `map-pin` 的百分比坐标是运行时计算值，无法写成类）
- 手拼 `.card` / `.modal` / `.field` / `.responsive-table`，应走 `js/ui/*`
- 暗色 / cyber 主题
- 自创颜色（只用 `css/source/foundation.css` 的 CSS 变量）
- 直接改 `css/style.css` / `css/style.min.css`（生成文件）

## 7. 构建与验收

```bash
# 编译样式（同时做模块链接 + HTML 资源存在性校验）
~/.local/node-v20.19.0-darwin-arm64/bin/node --experimental-vm-modules scripts/build.mjs

# 全量测试
~/.local/node-v20.19.0-darwin-arm64/bin/node --experimental-vm-modules --test tests/*.test.js
```

注意：macOS Tahoe 上系统 / brew 的 node 会被 SIGKILL，必须用上面这个路径的
node v20.19.0。

`css/style.min.css` **有意**与 `style.css` 内容相同，只作为旧 URL 的兼容入口
保留；不要对它做正则压缩（会破坏 `url()` 与 `calc()`）。

改动涉及 `COPY_LOCK.json` 覆盖的文件时，必须同步更新其中的 SHA-256，
否则 `copy-lock` 测试会以合同破坏为由失败。
