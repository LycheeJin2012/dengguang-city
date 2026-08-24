# 灯光市 UI 重做规范 (v1.0)

## 1. 风格保留
重做 UI 但**视觉语言完全保持不变**:
- 米色背景 (paper) + 黑色边框
- 像素风字体 (Press Start 2P)
- 偏移阴影 (4px / 8px)
- 主色: 草绿 (#5d7c15), 金色 (#ffaa00), 水蓝 (#3a7ad9), 红石 (#ff2a2a), 石头 (#7f7f7f)
- 不要加新颜色/新字体/新图案

## 2. 统一组件 CSS 类 (所有页面必须用)

### 按钮 (3 种)
```html
<button class="btn btn-primary">主操作</button>   <!-- 草绿/金色 -->
<button class="btn btn-ghost">次操作</button>     <!-- 米色+黑边 -->
<button class="btn btn-danger">危险</button>      <!-- 红石 -->
```

### 卡片
```html
<div class="card">...</div>                       <!-- 标准卡: paper 背景 + 4px 黑边 + 4px 偏移阴影 -->
<div class="card-flat">...</div>                  <!-- 无阴影卡 -->
<div class="card-pad">...</div>                   <!-- 内边距 16px -->
```

### 标题区 (pane-head)
```html
<div class="pane-head">
  <h2>标题</h2>
  <div class="pane-tools">
    <button class="btn btn-primary btn-sm">操作</button>
  </div>
</div>
```

### 空状态
```html
<div class="empty-state">
  <div class="empty-icon">📭</div>
  <p>暂无数据</p>
</div>
```

### 提示框 (pane-hint)
```html
<p class="pane-hint">这是一段说明文字。</p>
```

### 标签 (badge)
```html
<span class="tag">标签</span>
<span class="tag tag-success">成功</span>
<span class="tag tag-warn">警告</span>
<span class="tag tag-danger">危险</span>
<span class="tag tag-super">仅 SUPER</span>
```

### Modal
```html
<div class="modal-mask">
  <div class="modal">
    <div class="modal-head"><h3>标题</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">...</div>
  </div>
</div>
```

## 3. 各页面规则

### index.html (首页)
- 顶部红色提示条 (保留)
- Header: logo + 菜单 (保留)
- Hero: 大背景图 + 标题 + 副标题 + 2 个 CTA
- Stats: 3 张统计卡 (17/50+/2023.8)
- 公告区: 标题 + 卡片列表
- 数据看板: 4-5 张数据卡
- 实景图集: 网格布局图片卡
- Footer: 简单版权

### admin-new.html (管理后台)
- 顶部 Header (admin-logo + 返回首页)
- 用户条 (用户信息 + 退出)
- Tab 切换 (11 个 tab)
- 每个 tab: pane-head + 内容
- 公告/私信/图集 pane: 加 pane-hint
- Modal: 用统一 modal 组件

### hotel.html (酒店预订)
- Header
- 酒店卡片列表
- 房型选择 + 预订表单
- 我的预订

### profile.html (玩家主页)
- 头像 + 用户名
- 驾照等级 + 考试进度
- 我的赛道成绩
- 修改密码入口

### dm.html (私信)
- 对话列表
- 消息流
- 输入框

## 4. 不允许的写法
- 内联 style="background:#xxx" / style="color:#xxx" (用 class)
- 直接的 <p class="hint"> (用 <p class="pane-hint">)
- 暗色/cyber 主题 (admin panel 也要米色)
- 自创的颜色 (只用 CSS 变量)

## 5. 验收
- 所有 button 必须用 .btn + .btn-{primary|ghost|danger}
- 所有卡片必须有 .card 或 .card-flat
- 所有弹窗必须用 .modal-mask + .modal 结构
- 所有空状态必须用 .empty-state 模板
