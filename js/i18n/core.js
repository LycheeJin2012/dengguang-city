// v50-N5 基础设施: i18n (中英双语) 核心模块
// 架构: 三层 — 词典(dictionaries) / 当前语言(currentLang) / 翻译器(translate)
// 策略: localStorage 持久化, 缺省 zh-CN, document.documentElement.lang 同步
//
// 使用方式 (后续 commit 扩展):
//   1. HTML 加 data-i18n="key.path"  (例: <h1 data-i18n="hero.title">)
//   2. JS 调 t('key.path') 取值 (例: t('hero.cta') → '查看公告')
//   3. 切换语言: setLang('en'), 自动重新应用所有 data-i18n
//
// 现状 (N5 Step 1): 仅基础设施 + 主页 nav 翻译. 全站 5+ commit 扩展在后续.

const STORAGE_KEY = 'lc_lang';
const SUPPORTED = ['zh-CN', 'en'];

const DICT = {
  // ===== 主页 nav (最常用, 优先翻) =====
  'nav.home':       { 'zh-CN': '首页',         'en': 'Home' },
  'nav.notice':     { 'zh-CN': '公告',         'en': 'Notice' },
  'nav.data':       { 'zh-CN': '城市数据',     'en': 'Data' },
  'nav.scenery':    { 'zh-CN': '城市风貌',     'en': 'Scenery' },
  'nav.gallery':    { 'zh-CN': '实景图集',     'en': 'Gallery' },
  'nav.wall':       { 'zh-CN': '市民留言墙',   'en': 'Wall' },
  'nav.kart':       { 'zh-CN': '🛞 卡丁车',    'en': '🛞 Kart' },
  'nav.circuit':    { 'zh-CN': '🏎️ 国际赛车场', 'en': '🏎️ Circuit' },
  'nav.hotel':      { 'zh-CN': '树上酒店',     'en': 'Hotel' },
  'nav.service':    { 'zh-CN': '市民服务',     'en': 'Service' },
  'nav.contact':    { 'zh-CN': '联系我们',     'en': 'Contact' },
  'nav.leaderboard':{ 'zh-CN': '🏆 榜单',     'en': '🏆 Leaderboard' },
  'nav.toggle':     { 'zh-CN': '🌐 中文/EN',  'en': '🌐 EN/中' },
  // 通用
  'common.returnHome': { 'zh-CN': '← 返回首页',  'en': '← Home' },
  'common.loading':    { 'zh-CN': '载入中…',     'en': 'Loading…' },
  'common.back':       { 'zh-CN': '← 返回',       'en': '← Back' },
  'common.send':       { 'zh-CN': '发送',         'en': 'Send' },
  'common.sendFail':   { 'zh-CN': '发送失败: ',    'en': 'Send failed: ' },
  'common.comments':   { 'zh-CN': '评论',         'en': 'Comments' },
  'common.anonymous':  { 'zh-CN': '匿名',         'en': 'Anonymous' },
  'common.collapse':   { 'zh-CN': '收起评论',     'en': 'Collapse' },
  'profile.needLogin.title': { 'zh-CN': '请先登录查看个人主页', 'en': 'Please log in to view your profile' },
  'profile.needLogin.hint':  { 'zh-CN': '登录后自动跳转到你的个人主页', 'en': 'Log in to access your profile' },
  'profile.regDate':       { 'zh-CN': '注册日期：',       'en': 'Registered: ' },
  'profile.noBio':         { 'zh-CN': '这位玩家还没有写个人简介…', 'en': 'This player hasn\'t written a bio yet…' },
  'profile.editBtn':       { 'zh-CN': '✏️ 编辑我的主页',  'en': '✏️ Edit Profile' },
  'profile.changePwBtn':   { 'zh-CN': '🔑 修改密码',      'en': '🔑 Change Password' },
  'profile.sendDm':        { 'zh-CN': '📨 发私信',        'en': '📨 Send DM' },
  'profile.myDm':         { 'zh-CN': '📨 我的私信',      'en': '📨 My DMs' },
  'profile.loginToDm':    { 'zh-CN': '登录后发私信',     'en': 'Log in to send DMs' },
  'profile.stat.messages': { 'zh-CN': '留 言',            'en': 'Messages' },
  'profile.stat.comments': { 'zh-CN': '评 论',            'en': 'Comments' },
  'profile.tbd':           { 'zh-CN': '待公告',          'en': 'TBD' },
  'profile.editModal.title': { 'zh-CN': '编辑个人主页',  'en': 'Edit Profile' },
  // 通用相对时间 (notifications 页)
  'time.justNow':   { 'zh-CN': '刚刚',   'en': 'just now' },
  'time.minutesAgo': { 'zh-CN': ' 分钟前', 'en': ' min ago' },
  'time.hoursAgo':   { 'zh-CN': ' 小时前', 'en': ' hr ago' },
  'time.daysAgo':    { 'zh-CN': ' 天前',   'en': ' days ago' },
  // DM 页 (v50-N6 B6)
  'dm.thread.sub':       { 'zh-CN': '私信对话',                          'en': 'DM Thread' },
  'dm.thread.viewProfile':{ 'zh-CN': '查看对方主页 →',                   'en': 'View Profile →' },
  'dm.thread.inputPh':   { 'zh-CN': '输入私信内容（最多 2000 字）…',    'en': 'Type your message (max 2000 chars)…' },
  'dm.unread':          { 'zh-CN': '未读',                             'en': 'Unread' },
  'dm.sending':         { 'zh-CN': '发送中…',                          'en': 'Sending…' },
  'dm.sendFail':        { 'zh-CN': '发送失败：',                        'en': 'Send failed: ' },
  'dm.timeout.body':    { 'zh-CN': '验证登录态超时, 可能是网络抖动或 Functions 冷启动。<br>点下面按钮重试, 或回首页重新登录。',
                          'en': 'Login verification timed out. This may be network jitter or a cold start.<br>Click retry below, or go home and log in again.' },
  'dm.needLogin.body':  { 'zh-CN': '私信是玩家之间的私人交流，<br>需要登录后才能使用。',
                          'en': 'DMs are private player-to-player messages.<br>Log in to use this feature.' },
  'common.retry':      { 'zh-CN': '重试',                             'en': 'Retry' },
  // 表单通用状态 (v50-N6 B6)
  'form.submit.incomplete':    { 'zh-CN': '请完整填写 ✗',          'en': 'Please fill all fields ✗' },
  'form.submit.loading':       { 'zh-CN': '提交中…',              'en': 'Submitting…' },
  'form.submit.success':       { 'zh-CN': '✓ 已提交',             'en': '✓ Submitted' },
  'form.submit.fail':          { 'zh-CN': '提交失败 ✗',           'en': 'Failed ✗' },
  'form.submit.fail.default':  { 'zh-CN': '提交失败',             'en': 'Submit failed' },
  'form.submit.loginFirst':    { 'zh-CN': '请先登录玩家账号',      'en': 'Please log in first' },
  'form.submit.loginPrompt':   { 'zh-CN': '请先登录玩家账号再发留言', 'en': 'Log in to post a message' },
  // 主页客房卡片
  'home.room.bed.tbd':        { 'zh-CN': '床型待公告',            'en': 'TBD' },
  'home.room.guests':         { 'zh-CN': '+ 人',               'en': '+ guests' },
  'home.room.desc.tbd':       { 'zh-CN': '房型介绍待公告',        'en': 'Details coming soon' },
  'home.room.book':           { 'zh-CN': '📅 预订',             'en': '📅 Book' },
  'home.room.closed':         { 'zh-CN': '🚧 暂不开放',         'en': '🚧 Not available' },
  'home.room.featured':       { 'zh-CN': '★ 推荐',             'en': '★ Featured' },
  'home.room.building':       { 'zh-CN': '📝 筹建中',           'en': '📝 Under construction' },
  'home.room.price.tbd':      { 'zh-CN': '价格待定',            'en': 'Price TBD' },
  'home.room.perNight':       { 'zh-CN': '绿宝石/晚',          'en': 'emerald/night' },
  'home.room.bedInfo':        { 'zh-CN': '适合 ',               'en': 'For ' },
  'home.room.breakfast':      { 'zh-CN': '含早餐',              'en': 'Breakfast included' },
  // 预订 modal
  'book.perNight':           { 'zh-CN': ' / 晚',              'en': ' / night' },
  'book.selectDate':          { 'zh-CN': '— 请选择有效日期',      'en': '— Select valid dates' },
  'book.nights':             { 'zh-CN': ' 晚 · ',             'en': ' nights · ' },
  'book.persons':            { 'zh-CN': ' 人',                'en': ' guests' },
  'book.price.label':        { 'zh-CN': '绿宝石（房费 ',        'en': 'emerald (room ' },
  'book.price.perNight':     { 'zh-CN': ' 晚 × ',             'en': ' nights × ' },
  'book.price.bf':           { 'zh-CN': ' + 早餐 ',           'en': ' + breakfast ' },
  'book.price.bfUnit':       { 'zh-CN': ' 晚 ×  人 × ',       'en': ' nights × guests × ' },
  'book.price.close':         { 'zh-CN': '）',                 'en': ')' },
  'book.checkoutBefore':     { 'zh-CN': '退房日期必须晚于入住日期', 'en': 'Checkout must be after check-in' },
  'book.fillContact':        { 'zh-CN': '请填写姓名和联系方式',  'en': 'Please fill in name and contact' },
  'book.submit':             { 'zh-CN': '✓ 已提交（跨设备同步，管理员会确认）', 'en': '✓ Submitted (sync across devices, admin will confirm)' },
  'book.loginPrompt':        { 'zh-CN': '请先登录玩家账号再预订',  'en': 'Log in to make a booking' },
  'book.submitFail':         { 'zh-CN': '提交失败: ',          'en': 'Failed: ' },
  // 赛车/驾照表单
  'kart.fillIdContact':      { 'zh-CN': '请填写游戏 ID 和联系方式', 'en': 'Please fill in game ID and contact' },
  'kart.submit':             { 'zh-CN': '✓ 报名已提交（跨设备同步）', 'en': '✓ Signup submitted' },
  'kart.loginPrompt':        { 'zh-CN': '请先登录玩家账号再报名',   'en': 'Log in to sign up' },
  'circuit.fillIdContact':   { 'zh-CN': '请填写游戏 ID 和联系方式', 'en': 'Please fill in game ID and contact' },
  'circuit.submit':          { 'zh-CN': '✓ 报名已提交（跨设备同步）', 'en': '✓ Signup submitted' },
  // 驾照考试
  'license.written':         { 'zh-CN': '笔试 - 选择题 + 简答',  'en': 'Written - Multiple choice + Short answer' },
  'license.road':            { 'zh-CN': '路考 - 实景驾驶',      'en': 'Road test - Live driving' },
  'license.upgrade':         { 'zh-CN': '升级赛 - 极限测试',    'en': 'Upgrade race - Extreme test' },
  'license.modalTitle':      { 'zh-CN': '{grade} 级驾照报名',  'en': '{grade}-Tier License Signup' },
  'license.gradeLabel':      { 'zh-CN': '{grade} 级',          'en': 'Tier {grade}' },
  'license.signupPrompt':    { 'zh-CN': '请先登录玩家账号再报名考试', 'en': 'Log in to sign up for the exam' },
  'license.netError':       { 'zh-CN': '网络错误，请稍后再试',    'en': 'Network error, please try again later' },
  // 赛车规格
  'spec.price.tbd':          { 'zh-CN': '试车价格待公告',       'en': 'Trial price TBD' },
  'spec.km':                { 'zh-CN': 'km',                 'en': 'km' },
  'spec.surface.ice':       { 'zh-CN': '红石冰道',            'en': 'Redstone Ice Track' },
  'track.price.perTrial':   { 'zh-CN': '试车 ¥{price} 💎/次',   'en': 'Trial ¥{price} 💎/run' },
  'track.price.tbd':        { 'zh-CN': '试车价格待公告',        'en': 'Trial price TBD' },
  'track.price.loadFail':   { 'zh-CN': '试车价格加载失败',      'en': 'Failed to load trial price' },
  'license.grade.B':        { 'zh-CN': 'B 级（初级）',         'en': 'B (Beginner)' },
  'license.grade.A':        { 'zh-CN': 'A 级（中级）',         'en': 'A (Intermediate)' },
  'admin.statusLabel.pending':  { 'zh-CN': '待审批',         'en': 'Pending' },
  'admin.statusLabel.active':   { 'zh-CN': '已激活',         'en': 'Active' },
  'admin.statusLabel.rejected': { 'zh-CN': '已拒绝',         'en': 'Rejected' },
  'admin.examLabel.written':  { 'zh-CN': 'B 级笔试',       'en': 'B Written' },
  'admin.examLabel.road':     { 'zh-CN': 'A 级路考',       'en': 'A Road' },
  'admin.examLabel.upgrade':  { 'zh-CN': 'S 级升级',       'en': 'S Upgrade' },
  'admin.examBadge.pending':  { 'zh-CN': '待审',           'en': 'Pending' },
  'admin.examBadge.passed':   { 'zh-CN': '✓ 通过',         'en': '✓ Passed' },
  'admin.examBadge.failed':   { 'zh-CN': '✗ 未通过',       'en': '✗ Failed' },
  'admin.common.renderFail':  { 'zh-CN': '渲染失败',       'en': 'Render failed' },
  'admin.common.loadFail':    { 'zh-CN': '加载失败: ',     'en': 'Load failed: ' },
  'admin.common.fileTooBig':  { 'zh-CN': '文件太大 (上限 100MB)', 'en': 'File too large (max 100MB)' },
  'license.grade.S':        { 'zh-CN': 'S 级（高级 / 职业）',  'en': 'S (Advanced / Pro)' },
  // admin players tab
  'admin.players.neverLogin': { 'zh-CN': '从未登录',         'en': 'Never logged in' },
  'admin.players.regDate':   { 'zh-CN': '已注册：',        'en': 'Registered: ' },
  'admin.players.lastActive':{ 'zh-CN': '最后活跃：',      'en': 'Last active: ' },
  'admin.players.noBio':    { 'zh-CN': '暂无简介',        'en': 'No bio' },
  'admin.players.approve':  { 'zh-CN': '✓ 批准',          'en': '✓ Approve' },
  'admin.players.reject':    { 'zh-CN': '✗ 拒绝',          'en': '✗ Reject' },
  'admin.players.changeReject':{ 'zh-CN': '✗ 改为拒绝',    'en': '✗ Reject' },
  'admin.players.changeApprove':{ 'zh-CN': '↻ 改为批准', 'en': '↻ Approve' },
  'admin.players.resetPw':   { 'zh-CN': '🔑 重置密码',    'en': '🔑 Reset Password' },
  'admin.players.pwPrompt':  { 'zh-CN': '输入新密码 (至少 8 位):', 'en': 'Enter new password (min 8 chars):' },
  'admin.players.pwMin':    { 'zh-CN': '密码至少 8 位',    'en': 'Password must be at least 8 characters' },
  'admin.players.renamePrompt':{ 'zh-CN': '改玩家账号名 (2-32 字符, 不含 @):', 'en': 'Rename player (2-32 chars, no @):' },
  'admin.players.pwReset':   { 'zh-CN': '密码已重置',      'en': 'Password reset' },
  'admin.players.createTitle':{ 'zh-CN': '🆕 代注册玩家账号', 'en': '🆕 Register Player Account' },
  'admin.players.createDesc': { 'zh-CN': '由 super 管理员直接创建账号，无需玩家本人注册和审批。账号立即激活可用。', 'en': 'Super admins create accounts directly. No player registration or approval needed. Account is active immediately.' },
  // admin kart/circuit tab
  'admin.kart.kind.kart':  { 'zh-CN': '🏁 赛道试跑',  'en': '🏁 Kart Trial' },
  'admin.kart.kind.circuit':{ 'zh-CN': '🏎️ 国际赛车场', 'en': '🏎️ Circuit' },
  'admin.status.pending':  { 'zh-CN': '待审核',       'en': 'Pending' },
  'admin.status.approved':{ 'zh-CN': '已批准',       'en': 'Approved' },
  'admin.status.rejected': { 'zh-CN': '已拒绝',       'en': 'Rejected' },
  'admin.kart.edit':       { 'zh-CN': '✎ 编辑',      'en': '✎ Edit' },
  'admin.kart.editTitle':  { 'zh-CN': '编辑',         'en': 'Edit' },
  'admin.kart.save':       { 'zh-CN': '保存状态',     'en': 'Save' },
  'admin.kart.delete':     { 'zh-CN': '删除',         'en': 'Delete' },
  'admin.kart.confirmDel': { 'zh-CN': '删除该报名？',  'en': 'Delete this signup?' },
  'admin.kart.fail':      { 'zh-CN': '失败: ',       'en': 'Failed: ' },
  'admin.kart.deleted':    { 'zh-CN': '已删除',        'en': 'Deleted' },
  'admin.kart.saved':      { 'zh-CN': '已保存',        'en': 'Saved' },
  'admin.passkey.added':  { 'zh-CN': '✓ 通行密钥已添加', 'en': '✓ Passkey added' },
  'admin.passkey.fail':   { 'zh-CN': '添加失败: ',      'en': 'Add failed: ' },
  'admin.passkey.notCreated': { 'zh-CN': '未创建凭据',  'en': 'Credential not created' },
  'admin.ann.new':        { 'zh-CN': '📢 新公告',        'en': '📢 New Announcement' },
  'admin.ann.edit':       { 'zh-CN': '✎ 编辑公告',       'en': '✎ Edit Announcement' },
  'admin.ann.titleLabel': { 'zh-CN': '标题 * (2-80 字)',  'en': 'Title * (2-80 chars)' },
  'admin.ann.imgLabel':   { 'zh-CN': '封面图 URL (可选, https:// 或 data:image/ 开头)', 'en': 'Cover image URL (optional, https:// or data:image/)' },
  'admin.ann.contentLabel': { 'zh-CN': '内容 * (2-2000 字)', 'en': 'Content * (2-2000 chars)' },
  'admin.ann.empty':      { 'zh-CN': '标题/内容不能为空', 'en': 'Title and content cannot be empty' },
  'admin.ann.saveFail':  { 'zh-CN': '保存失败: ',       'en': 'Save failed: ' },
  'admin.ann.confirmDel':{ 'zh-CN': '删除该公告？',     'en': 'Delete this announcement?' },
  'admin.ann.latest':     { 'zh-CN': '最新',            'en': 'Latest' },
  'admin.ann.edited':     { 'zh-CN': '已编辑',          'en': 'Edited' },
  'admin.ann.publish':   { 'zh-CN': '发布',            'en': 'Publish' },
  'admin.announcements.title': { 'zh-CN': '📢 市政公告管理', 'en': '📢 Announcement Management' },
  'admin.super.only':   { 'zh-CN': '仅 SUPER',          'en': 'SUPER Only' },
  'admin.announcements.hint':  { 'zh-CN': '公告会出现在首页"市政公告"栏目, 所有人可见。仅 super 管理员可发布/编辑/删除。', 'en': 'Announcements appear on the homepage. Everyone can see them. Only SUPER admins can publish/edit/delete.' },
  'admin.announcements.createBtn': { 'zh-CN': '+ 发布新公告', 'en': '+ New Announcement' },
  'common.cancel':       { 'zh-CN': '取消',            'en': 'Cancel' },
  'common.close':        { 'zh-CN': '关闭',            'en': 'Close' },
  'common.save':         { 'zh-CN': '保存',            'en': 'Save' },
  'kbd.title':           { 'zh-CN': '键盘快捷键',     'en': 'Keyboard Shortcuts' },
  'kbd.tip':             { 'zh-CN': '在输入框/留言框中按键时, 快捷键不会触发。', 'en': 'Shortcuts are disabled while typing in input fields.' },
  'kbd.contact':         { 'zh-CN': '留言区',         'en': 'Guestbook' },
  'kbd.home':            { 'zh-CN': '回到顶部',       'en': 'Top' },
  'kbd.notice':          { 'zh-CN': '公告',           'en': 'Notice' },
  'kbd.data':            { 'zh-CN': '城市数据',       'en': 'City Data' },
  'kbd.service':         { 'zh-CN': '市民服务',       'en': 'Services' },
  'kbd.scenery':         { 'zh-CN': '城市风貌',       'en': 'Scenery' },
  'kbd.help':            { 'zh-CN': '显示帮助',       'en': 'Show Help' },
  'common.saving':       { 'zh-CN': '保存中…',         'en': 'Saving...' },
  'admin.modal.close':   { 'zh-CN': '✕',               'en': '✕' },
  'profile.editModal.avatarLabel': { 'zh-CN': '头像（一个 emoji）', 'en': 'Avatar (one emoji)' },
  'profile.editModal.avatarHint':  { 'zh-CN': '提示：1-4 个字符，建议是 emoji（如 🏎️ 🐱 🎮）', 'en': 'Tip: 1-4 chars, emoji recommended (e.g. 🏎️ 🐱 🎮)' },
  'profile.editModal.bioLabel':    { 'zh-CN': '个人简介',       'en': 'Bio' },
  'profile.editModal.bioPh':       { 'zh-CN': '介绍一下自己…',   'en': 'Tell us about yourself...' },
  'profile.editModal.bioHint':     { 'zh-CN': '最多 500 字。市政厅不对内容做审核，请文明发言。', 'en': 'Max 500 chars. City Hall does not moderate content — please be civil.' },
  'profile.editModal.saveFail':    { 'zh-CN': '保存失败：',     'en': 'Save failed: ' },
  'messages.replyTag.ai':   { 'zh-CN': '🤖 AI 已回复',    'en': '🤖 AI Replied' },
  'messages.replyTag.human':{ 'zh-CN': '💬 人工已回复',  'en': '💬 Replied' },
  'messages.replyTag.wait':  { 'zh-CN': '⏳ 待回复',      'en': '⏳ Pending' },
  'messages.adminReply':     { 'zh-CN': '📣 市政厅回复:', 'en': '📣 City Hall Reply:' },
  // hotel 页
  'hotel.status':   { 'zh-CN': '状态：',       'en': 'Status:' },
  'hotel.guests':   { 'zh-CN': '入住人数：',   'en': 'Guests:' },
  'hotel.view':     { 'zh-CN': '景观：',       'en': 'View:' },
  'hotel.filter.reset': { 'zh-CN': '重置筛选',  'en': 'Reset' },
  'hotel.filter.all':   { 'zh-CN': '全部',      'en': 'All' },
  'hotel.filter.open':  { 'zh-CN': '开放',      'en': 'Open' },
  'hotel.filter.draft': { 'zh-CN': '草拟',      'en': 'Draft' },
  'hotel.filter.building': { 'zh-CN': '筹建',   'en': 'Building' },
  'hotel.filter.planned':  { 'zh-CN': '拟建',   'en': 'Planned' },
  'hotel.bed.tbd':        { 'zh-CN': '床型待公告',  'en': 'TBD' },
  'hotel.view.label':     { 'zh-CN': '景观：',       'en': 'View: ' },
  'hotel.breakfast.yes':  { 'zh-CN': '含早餐',      'en': 'Breakfast included' },
  'hotel.breakfast.no':   { 'zh-CN': '不含早餐',     'en': 'No breakfast' },
  'hotel.address':        { 'zh-CN': '地址: ',       'en': 'Address: ' },
  'hotel.count.fallback':  { 'zh-CN': '— / —',       'en': '— / —' },
  'hotel.modal.detail': { 'zh-CN': '房型详情',  'en': 'Room Detail' },
  'hotel.modal.book':   { 'zh-CN': '预订房间',  'en': 'Book Room' },
  'hotel.count':        { 'zh-CN': '共 ${n} 间 / 总 ${total} 间', 'en': '${n} / ${total} rooms' },
  'hotel.empty':        { 'zh-CN': '酒店正在筹建中, 上线后会在这里显示。', 'en': 'Hotel under construction. Will be available soon.' },
  // profile 页
  'profile.passkey.head':  { 'zh-CN': '🔑 账号安全 · 通行密钥 (Passkey)',  'en': '🔑 Account Security · Passkey' },
  'profile.race.head':     { 'zh-CN': '🏁 赛道成绩',                       'en': '🏁 Race Records' },
  'profile.exam.head':     { 'zh-CN': '📝 驾照模拟题库',                   'en': '📝 License Practice' },
  'profile.sub.head':      { 'zh-CN': '🔔 通知订阅',                       'en': '🔔 Notification Subscriptions' },
  'profile.citizen.head':  { 'zh-CN': '🪪 我的市民身份卡',                 'en': '🪪 My Citizen Card' },
  'profile.passkey.desc':   { 'zh-CN': '通行密钥用 Touch ID / Face ID / Windows Hello 登录，<b>无需输密码</b>，抗钓鱼。', 'en': 'Passkeys use Touch ID / Face ID / Windows Hello — <b>no password needed</b>, phishing-resistant.' },
  'profile.passkey.addBtn':  { 'zh-CN': '➕ 添加通行密钥',                    'en': '➕ Add Passkey' },
  'profile.race.desc':      { 'zh-CN': '上报你在国际赛车场的圈速，进入排行榜跟全城玩家 PK！', 'en': 'Submit your lap times at the International Circuit and compete on the leaderboard!' },
  'profile.exam.desc':      { 'zh-CN': '考前去模拟题库里练手，错了的题自动进"错题本"反复练习。', 'en': 'Practice in the mock exam before the real test — wrong answers auto-saved to your notebook.' },
  'profile.sub.desc':       { 'zh-CN': '勾选订阅后，新公告/你的留言被回复/新私信会通过站内通知推送给你。', 'en': 'Once subscribed, new announcements, replies to your messages, and DMs will push in-site notifications.' },
  'profile.citizen.desc':   { 'zh-CN': '点下面的按钮生成你的专属市民卡，可以下载发到 MC 服务器群跟小伙伴炫一下！', 'en': 'Click below to generate your unique citizen card — download it and share it in your MC server!' },
  'profile.citizen.genBtn': { 'zh-CN': '🎴 生成我的市民卡',                    'en': '🎴 Generate My Citizen Card' },
  'profile.citizen.downloadTip': { 'zh-CN': '右键下方"下载"按钮保存为 SVG 文件（可粘贴到 MC 群或转 PNG）。', 'en': 'Right-click the "Download" button below and save as SVG — paste into your MC server or convert to PNG.' },
  'profile.citizen.downloadBtn': { 'zh-CN': '⬇️ 下载 SVG',                          'en': '⬇️ Download SVG' },
  'profile.citizen.copyBtn':    { 'zh-CN': '📋 复制 SVG 源码',                    'en': '📋 Copy SVG Source' },
  'profile.citizen.copied':     { 'zh-CN': '已复制',                              'en': 'Copied' },
  'profile.citizen.copyFailed': { 'zh-CN': '复制失败: ',                          'en': 'Copy failed: ' },
  'profile.error.loadFailed':    { 'zh-CN': '载入失败',                            'en': 'Failed to load' },
  'profile.error.playerNotFound':{ 'zh-CN': '该玩家可能不存在或账号未激活',       'en': 'This player may not exist or the account is inactive.' },
  'profile.history.messagesHead':{ 'zh-CN': '📜 我最近的市民留言',                'en': '📜 My Recent Messages' },
  'profile.history.bookingsHead':{ 'zh-CN': '📋 我最近的报名',                    'en': '📋 My Recent Signups' },
  'profile.history.tagAiReply':  { 'zh-CN': '🤖 AI 已回复',                       'en': '🤖 AI Replied' },
  'profile.history.tagReplied':  { 'zh-CN': '已回复',                             'en': 'Replied' },
  'profile.history.tagPending':  { 'zh-CN': '⏳ 待回复',                          'en': '⏳ Pending' },
  'profile.history.booking.hotel':{ 'zh-CN': '酒店',                              'en': 'Hotel' },
  'profile.history.booking.night':{ 'zh-CN': '晚',                               'en': 'night' },
  'profile.history.booking.bfast':{ 'zh-CN': '含早餐',                            'en': 'incl. breakfast' },
  'profile.history.booking.room':{ 'zh-CN': '房型',                               'en': 'Room' },
  'profile.history.booking.license':{ 'zh-CN': '驾照',                           'en': 'License' },
  'profile.history.booking.written':{ 'zh-CN': '笔试',                           'en': 'Written' },
  'profile.history.booking.road': { 'zh-CN': '路考',                              'en': 'Road Test' },
  'profile.history.booking.upgrade':{ 'zh-CN': '升级',                           'en': 'Upgrade' },
  'profile.history.booking.tbd':  { 'zh-CN': '日期待定',                          'en': 'TBD' },
  'profile.history.booking.kart': { 'zh-CN': '赛道',                              'en': 'Karting' },
  'profile.history.booking.sessionTbd':{ 'zh-CN': '场次待定',                    'en': 'TBD session' },
  'profile.history.booking.circuit':{ 'zh-CN': '赛车场',                        'en': 'Circuit' },
  'profile.history.booking.circuitTrial':{ 'zh-CN': '国际赛车场试车',             'en': 'International Circuit Trial' },
  // dm 页
  'dm.verifyLogin':    { 'zh-CN': '正在验证登录态…',     'en': 'Verifying login…' },
  'dm.newBtn':         { 'zh-CN': '+ 写新私信',         'en': '+ New DM' },
  'dm.loading':        { 'zh-CN': '载入中…',             'en': 'Loading…' },
  'dm.empty.title':    { 'zh-CN': '还没有私信',         'en': 'No messages yet' },
  'dm.empty.hint':     { 'zh-CN': '点右上角"写新私信"开始', 'en': 'Click "+ New DM" to start' },
  'dm.empty.thread':   { 'zh-CN': '← 选择左侧会话查看<br>或点击右上"写新私信"', 'en': '← Pick a thread on the left<br>or click "+ New DM"' },
  'dm.empty.loadFail': { 'zh-CN': '载入失败',            'en': 'Load failed' },
  'dm.empty.noMsgs':   { 'zh-CN': '还没有消息，发起对话吧！', 'en': 'No messages yet. Start a conversation!' },
  'dm.slow':           { 'zh-CN': '网络好像有点慢',     'en': 'Network seems slow' },
  'dm.needLogin':      { 'zh-CN': '请先登录玩家账号',   'en': 'Please log in to a player account' },
  'dm.inbox':          { 'zh-CN': '私信收件箱',         'en': 'DM Inbox' },
  'dm.aibot.btn':      { 'zh-CN': '找 AI 客服灯灯聊聊',  'en': 'Chat with AI Support' },
  'dm.aibot.hint':     { 'zh-CN': '24h 自动回复 · 100 字内', 'en': '24h auto-reply · max 100 chars' },
  'dm.err.isAdmin':    { 'zh-CN': '当前是管理员账号, 没有关联玩家身份', 'en': 'This is an admin account, no linked player' },
  'dm.err.timeoutShort':{ 'zh-CN': '网络超时/失败: ',    'en': 'Network timeout/failure: ' },
  // admin-v37 tab 标签
  'admin.tab.tickets':      { 'zh-CN': '工单中心',         'en': 'Tickets' },
  'admin.tab.players':      { 'zh-CN': '玩家管理',         'en': 'Players' },
  'admin.tab.kart':         { 'zh-CN': '赛道 / 国际试车',  'en': 'Kart / Circuit' },
  'admin.tab.announcements': { 'zh-CN': '公告管理',         'en': 'Announcements' },
  'admin.tab.gallery':      { 'zh-CN': '首页图集',         'en': 'Gallery' },
  'admin.tab.dms':          { 'zh-CN': '私信监管',         'en': 'DM Monitor' },
  'admin.tab.admins':       { 'zh-CN': '管理员账号',       'en': 'Admins' },
  'admin.tab.password':     { 'zh-CN': '修改我的密码',     'en': 'Change Password' },
  // admin 登录页
  'admin.login.header':     { 'zh-CN': '灯光市 · 管理后台',       'en': 'Light City · Admin Console' },
  'admin.login.backHome':   { 'zh-CN': '← 返回首页',              'en': '← Back to Home' },
  'admin.login.brandTitle': { 'zh-CN': '灯光市',                  'en': 'Light City' },
  'admin.login.brandDesc':  { 'zh-CN': '市政厅内部管理系统。仅授权管理员可访问，所有操作留痕审计。', 'en': 'City Hall Internal System. Authorized admins only — all actions are audited.' },
  'admin.login.featMsgs':   { 'zh-CN': '市民留言审核',            'en': 'Citizen Message Review' },
  'admin.login.featHotel':  { 'zh-CN': '酒店 / 赛车场管理',       'en': 'Hotel & Circuit Mgmt' },
  'admin.login.featAnn':    { 'zh-CN': '公告 / 图集发布',         'en': 'Announcements & Gallery' },
  'admin.login.featAdmin':  { 'zh-CN': '管理员账号 / 权限',      'en': 'Admin Accounts & Permissions' },
  'admin.login.title':      { 'zh-CN': '管理员登录',              'en': 'Admin Login' },
  'admin.login.labelUser':  { 'zh-CN': '账号',                   'en': 'Username' },
  'admin.login.labelPass':  { 'zh-CN': '密码',                   'en': 'Password' },
  'admin.login.submit':     { 'zh-CN': '▶ 登录',                 'en': '▶ Sign In' },
  'admin.login.or':         { 'zh-CN': '或',                     'en': 'or' },
  'admin.login.passkeyTitle':{ 'zh-CN': '用通行密钥登录 (需玩家账号已绑管理员)', 'en': 'Sign in with Passkey (player account must be linked to admin first)' },
  'admin.login.passkeyBtn': { 'zh-CN': '🔑 用通行密钥登录',      'en': '🔑 Sign in with Passkey' },
  'admin.login.hint':       { 'zh-CN': '提示: 玩家账号先在主页用 Touch ID/Face ID 注册通行密钥，然后绑定到管理员账号 (admin 端有"玩家管理" → "🔗 绑管理员" 按钮)，即可一键登 admin', 'en': 'Tip: Register a passkey on the main site with Touch ID/Face ID, then link it to your admin account (Admin → "Players" → "🔗 Link") for one-click login.' },
  'admin.login.backHome2':  { 'zh-CN': '← 返回市民首页',         'en': '← Back to Home' },
  'admin.dash.logout':      { 'zh-CN': '退出登录',               'en': 'Logout' },
  'admin.dash.refreshTip':  { 'zh-CN': '刷新数据',               'en': 'Refresh data' },
  'admin.dash.refresh':     { 'zh-CN': '🔄 刷新',                'en': '🔄 Refresh' },
  'admin.ticket.paneTitle': { 'zh-CN': '🎫 工单中心',            'en': '🎫 Ticket Center' },
  // admin 管理员账号 tab
  'admin.admins.unlinked':  { 'zh-CN': '未绑玩家',        'en': 'Not linked' },
  'admin.admins.registered':{ 'zh-CN': '注册',            'en': 'Registered' },
  'admin.admins.resetPw':   { 'zh-CN': '重置密码',        'en': 'Reset Password' },
  'admin.admins.unlink':   { 'zh-CN': '解绑玩家',        'en': 'Unlink Player' },
  'admin.admins.link':      { 'zh-CN': '绑玩家',          'en': 'Link Player' },
  'admin.admins.delete':   { 'zh-CN': '删除',            'en': 'Delete' },
  'admin.admins.role.super':{ 'zh-CN': 'SUPER',          'en': 'SUPER' },
  'admin.admins.role.admin':{ 'zh-CN': 'ADMIN',           'en': 'ADMIN' },
  'admin.admins.resetPw.prompt': { 'zh-CN': '输入新密码（至少 8 位）:', 'en': 'Enter new password (min 8 chars):' },
  'admin.admins.resetPw.success':{ 'zh-CN': '密码已重置',  'en': 'Password reset' },
  'admin.admins.unlink.confirm':{ 'zh-CN': '确定解绑该管理员的关联玩家账号？', 'en': 'Unlink this admin from their player account?' },
  'admin.admins.delete.confirm':{ 'zh-CN': '确定删除该管理员账号？', 'en': 'Delete this admin account?' },
  'admin.admins.link.prompt':  { 'zh-CN': '输入要绑定的玩家 ID:', 'en': 'Enter player ID to link:' },
  'admin.admins.merge.confirm': { 'zh-CN': '绑定 admin #{adminId} ↔ player #{playerId}？合并后两边可互相登录。', 'en': 'Link admin #{adminId} ↔ player #{playerId}? Both accounts can log in after merge.' },
  'admin.admins.fail':        { 'zh-CN': '操作失败',      'en': 'Operation failed' },
  // admin 私信监管 tab
  'admin.dms.unread':         { 'zh-CN': '未读',          'en': 'Unread' },
  'admin.dms.replied':        { 'zh-CN': '已被 {name} 回复', 'en': 'Replied by {name}' },
  'admin.dms.viewThread':     { 'zh-CN': '查看会话',      'en': 'View Thread' },
  'admin.dms.dmThread':       { 'zh-CN': '私信会话',      'en': 'DM Thread' },
  'admin.dms.close':          { 'zh-CN': '关闭',          'en': 'Close' },
  'admin.dms.noAiFallback':   { 'zh-CN': '无 AI 兜底记录', 'en': 'No AI fallback records' },
  'admin.dms.aiFallback':     { 'zh-CN': 'AI 兜底 #{id}', 'en': 'AI Fallback #{id}' },
  // 页面 title
  'page.title.home':    { 'zh-CN': '灯光市人民政府 | Light City Hall of MC', 'en': 'Light City Hall | MC Government' },
  'page.title.hotel':   { 'zh-CN': '树上酒店 · 预订 | 灯光市人民政府',         'en': 'Treehouse Hotel | Light City Hall' },
  'page.title.profile': { 'zh-CN': '玩家主页 · 灯光市',                       'en': 'Player Profile | Light City' },
  'page.title.dm':      { 'zh-CN': '私信 · 灯光市',                           'en': 'DM | Light City' },
  'page.title.leaderboard': { 'zh-CN': '玩家榜单 · 灯光市人民政府',           'en': 'Player Leaderboard | Light City' },
  'page.title.notifications': { 'zh-CN': '通知中心 · 灯光市人民政府',          'en': 'Notification Center | Light City' },
  'page.title.admin':   { 'zh-CN': '管理后台 | 灯光市人民政府',                 'en': 'Admin Panel | Light City Hall' },
  'page.sub.hotel':    { 'zh-CN': 'TREEHOUSE HOTEL · 房型与预订',            'en': 'TREEHOUSE HOTEL · Rooms & Booking' },
  // 表单 placeholder
  'ph.gameId':         { 'zh-CN': '你的游戏 ID',         'en': 'Your game ID' },
  'ph.gameIdShort':    { 'zh-CN': '你的游戏ID',         'en': 'Game ID' },
  'ph.contact':         { 'zh-CN': '邮箱 / 游戏内编号',   'en': 'Email / In-game ID' },
  'ph.contactShort':    { 'zh-CN': '邮箱或游戏内编号',   'en': 'Email or In-game ID' },
  'ph.adminUser':       { 'zh-CN': '管理员账号',         'en': 'Admin Username' },
  'ph.message':         { 'zh-CN': '请输入你的留言...',   'en': 'Type your message...' },
  'ph.note':            { 'zh-CN': '是否需要教学、组队信息等', 'en': 'Need teaching or team info?' },
  'ph.noteSpecial':     { 'zh-CN': '特殊要求、纪念日等',  'en': 'Special requests, anniversaries, etc.' },
  'ph.carNo':           { 'zh-CN': '留空随机分配',       'en': 'Empty for random' },
  'ph.ticketSearch':    { 'zh-CN': '🔍 搜索标题/内容',   'en': '🔍 Search title/content' },
  // meta description (SEO)
  'page.meta.home':    { 'zh-CN': '灯光市人民政府官方网站 - 由市民共建的像素城市，提供政务公告、城市数据与市民服务。',
                         'en': 'Light City Hall - A pixel city built by citizens, offering government notices, city data, and public services.' },
  'page.meta.hotel':   { 'zh-CN': '灯光市树上酒店 - 房型浏览、状态筛选、预订。',
                         'en': 'Light City Treehouse Hotel - Room browsing, status filters, and booking.' },
  'page.meta.profile': { 'zh-CN': '灯光市玩家主页 - 我的留言、报名、订阅、通知。',
                         'en': 'Light City Player Profile - My messages, signups, subscriptions, and notifications.' },
  'page.meta.dm':      { 'zh-CN': '灯光市私信 - AI 灯灯客服 / 玩家私信。',
                         'en': 'Light City DM - AI assistant DengDeng & player direct messages.' },
  'page.meta.leaderboard': { 'zh-CN': '灯光市玩家排行榜 - 留言数 / 酒店预订 / 驾照等级 3 维度, 看谁是灯光市最活跃的市民。',
                             'en': 'Light City Player Leaderboard - Top contributors in messages, bookings, and licenses.' },
  'page.meta.notifications': { 'zh-CN': '灯光市通知中心 - 站内所有通知, 留言回复 / DM / 公告 / 订阅推送。',
                               'en': 'Light City Notification Center - All in-site notifications: replies, DMs, announcements.' },
  'page.meta.admin':   { 'zh-CN': '灯光市管理后台 - 工单 / 玩家 / 赛车场 / 公告 / 图集 / 私信监管。',
                         'en': 'Light City Admin Panel - Tickets / players / kart / announcements / gallery / DM monitor.' },
  // 主页 6 个服务卡
  'service.register.title': { 'zh-CN': '市民身份登记',          'en': 'Citizen Registration' },
  'service.register.desc':  { 'zh-CN': '新市民注册、身份卡补办、户籍迁移', 'en': 'New citizen registration, ID replacement, household migration' },
  'service.land.title':     { 'zh-CN': '地块认领申请',          'en': 'Land Claim' },
  'service.land.desc':      { 'zh-CN': '空置地块查询、认领抽签、产权变更', 'en': 'Vacant land search, claim lottery, ownership transfer' },
  'service.build.title':    { 'zh-CN': '建筑报建',              'en': 'Building Permit' },
  'service.build.desc':     { 'zh-CN': '建筑高度、外立面材料、红石结构审核', 'en': 'Height, facade materials, redstone structure review' },
  'service.power.title':    { 'zh-CN': '红石用电报装',          'en': 'Redstone Power' },
  'service.power.desc':     { 'zh-CN': '报装容量申请、线路走向、故障报修', 'en': 'Capacity request, line routing, fault repair' },
  'service.market.title':   { 'zh-CN': '市集摊位申请',          'en': 'Market Stall' },
  'service.market.desc':    { 'zh-CN': '每周末市集摊位预约、收费与卫生管理', 'en': 'Weekend market stall booking, fees & sanitation' },
  'service.feedback.title': { 'zh-CN': '建议与投诉',            'en': 'Feedback' },
  'service.feedback.desc':  { 'zh-CN': '城市治理建议、违规行为投诉、表扬信', 'en': 'City governance, violation reports, commendations' },
  'section.services.title': { 'zh-CN': '🛎️ 市民服务中心',  'en': '🛎️ Civic Services' },
  'section.services.sub':   { 'zh-CN': 'CIVIC SERVICES · 办事大厅', 'en': 'CIVIC SERVICES · Service Hall' },
  // footer
  'footer.tagline':    { 'zh-CN': '由市民共建',  'en': 'Built by Citizens' },
  'footer.col.gov':    { 'zh-CN': '政务',         'en': 'Government' },
  'footer.col.service':{ 'zh-CN': '服务',         'en': 'Service' },
  'footer.copy':       { 'zh-CN': '本站为作品展示 · 与 Mojang/Microsoft 无关', 'en': 'Showcase project. Not affiliated with Mojang/Microsoft.' },
  'footer.admin':      { 'zh-CN': '管理入口',  'en': 'Admin' },
  'contact.title':     { 'zh-CN': '联系我们',  'en': 'Contact Us' },
  'topStrip.text':     { 'zh-CN': '本站为灯光市人民政府官方网站（搭建中）。公告与新闻将由市政厅正式发布后呈现。',
                         'en': 'Official site of the Light City Hall (under construction). Announcements will be published by the city hall.' },
  'topStrip.latest':    { 'zh-CN': '最新公告',         'en': 'Latest' },
  'service.registerPrompt': { 'zh-CN': '新市民注册 · 填写用户名+邮箱+密码即可', 'en': 'New Citizen Signup — fill in username, email, and password' },
  'service.type.land':     { 'zh-CN': '合作',     'en': 'Partnership' },
  'service.type.build':    { 'zh-CN': '咨询',     'en': 'Inquiry' },
  'service.type.power':    { 'zh-CN': '投诉',     'en': 'Complaint' },
  'service.type.market':   { 'zh-CN': '合作',     'en': 'Partnership' },
  'service.type.feedback': { 'zh-CN': '建议',     'en': 'Feedback' },
  // 通行密钥 (WebAuthn / Passkey)
  'passkey.empty':         { 'zh-CN': '还没有通行密钥。点击下方按钮添加。', 'en': 'No passkey yet. Click the button below to add one.' },
  'passkey.lastUsed':      { 'zh-CN': '上次使用: ',       'en': 'Last used: ' },
  'passkey.neverUsed':     { 'zh-CN': '尚未使用',         'en': 'Never used' },
  'passkey.registered':    { 'zh-CN': '注册于',           'en': 'Registered' },
  'passkey.confirmDel':    { 'zh-CN': '确认删除此通行密钥？删除后无法再用它登录。', 'en': 'Delete this passkey? You will not be able to log in with it again.' },
  'passkey.unsupported':   { 'zh-CN': '您的浏览器不支持通行密钥', 'en': 'Your browser does not support passkeys' },
  'passkey.namePrompt':    { 'zh-CN': '给这个通行密钥起个名字（例：iPhone 15、MacBook）：', 'en': 'Name this passkey (e.g., iPhone 15, MacBook):' },
  'passkey.defaultName':   { 'zh-CN': '我的设备',         'en': 'My Device' },
  'passkey.deleted':       { 'zh-CN': '已删除',           'en': 'Deleted' },
  'passkey.delFail':       { 'zh-CN': '删除失败',         'en': 'Delete failed' },
  'passkey.noCredId':      { 'zh-CN': '该密钥无 credential_id', 'en': 'No credential_id for this passkey' },
  'passkey.testing':       { 'zh-CN': '验证中…',          'en': 'Verifying…' },
  'passkey.testHint':      { 'zh-CN': '正在验证通行密钥，请触摸指纹 / Face ID…', 'en': 'Verifying passkey. Touch fingerprint / Face ID…' },
  'passkey.challengeFail': { 'zh-CN': '获取挑战失败',      'en': 'Failed to get challenge' },
  'passkey.noCred':        { 'zh-CN': '未选择凭据',        'en': 'No credential selected' },
  'passkey.verifyFail':    { 'zh-CN': '验证失败',          'en': 'Verification failed' },
  'passkey.valid':         { 'zh-CN': '通行密钥有效!',     'en': 'Passkey is valid!' },
  // 驾照模拟题库 (profile exam-practice)
  'exam.grade.B':          { 'zh-CN': 'B 级（初级）',     'en': 'B Tier (Beginner)' },
  'exam.grade.A':          { 'zh-CN': 'A 级（中级）',     'en': 'A Tier (Intermediate)' },
  'exam.grade.S':          { 'zh-CN': 'S 级（高级）',     'en': 'S Tier (Advanced)' },
  'exam.btn.practice':     { 'zh-CN': '练',               'en': 'Practice' },
  'exam.btn.submit':       { 'zh-CN': '提交',             'en': 'Submit' },
  'exam.btn.skip':         { 'zh-CN': '跳过',             'en': 'Skip' },
  'exam.btn.again':        { 'zh-CN': '再来一组',          'en': 'Try Again' },
  'exam.btn.next':         { 'zh-CN': '下一题 →',         'en': 'Next →' },
  'exam.wrongBook':        { 'zh-CN': '错题本',            'en': 'Wrong Answers' },
  'exam.noWrong':          { 'zh-CN': '还没错题',          'en': 'No wrong answers yet' },
  'exam.loading':          { 'zh-CN': '抽题中…',          'en': 'Loading questions…' },
  'exam.emptyBank':        { 'zh-CN': '题库还是空的, 先练别的等级', 'en': 'Question bank is empty. Try another grade.' },
  'exam.done':             { 'zh-CN': '答完啦!',          'en': 'Done!' },
  'exam.correctRate':      { 'zh-CN': '答对',             'en': 'Correct' },
  'exam.question':         { 'zh-CN': '第',               'en': 'Question' },
  'exam.questionOf':       { 'zh-CN': '题 · ',            'en': 'of' },
  'exam.qType.multi':      { 'zh-CN': '多选',             'en': 'Multi' },
  'exam.qType.judge':      { 'zh-CN': '判断',             'en': 'True/False' },
  'exam.qType.single':     { 'zh-CN': '单选',             'en': 'Single' },
  'exam.judgeTrue':        { 'zh-CN': '正确',             'en': 'True' },
  'exam.judgeFalse':       { 'zh-CN': '错误',             'en': 'False' },
  'exam.pickFirst':        { 'zh-CN': '请先选答案',        'en': 'Pick an answer first' },
  'exam.correct':          { 'zh-CN': '答对了',            'en': 'Correct' },
  'exam.wrong':            { 'zh-CN': '答错了',            'en': 'Wrong' },
  'exam.answer':           { 'zh-CN': '正确答案',          'en': 'Correct answer' },
  // 赛道圈速 (profile race-times)
  'race.submitTitle':      { 'zh-CN': '上报新成绩',        'en': 'Submit New Time' },
  'race.track':            { 'zh-CN': '赛道',              'en': 'Track' },
  'race.time':             { 'zh-CN': '用时 (mm:ss.fff)', 'en': 'Time (mm:ss.fff)' },
  'race.timePh':           { 'zh-CN': '如 1:23.456',       'en': 'e.g. 1:23.456' },
  'race.kart':             { 'zh-CN': '卡丁/车型',         'en': 'Kart/Vehicle' },
  'race.kartPh':           { 'zh-CN': '如 MK4',            'en': 'e.g. MK4' },
  'race.btn.submit':       { 'zh-CN': '提交',              'en': 'Submit' },
  'race.myTimes':          { 'zh-CN': '我的成绩',          'en': 'My Times' },
  'race.noMine':           { 'zh-CN': '还没有成绩, 上报一个试试', 'en': 'No times yet. Submit one to get started.' },
  'race.verified':         { 'zh-CN': '已认证',            'en': 'Verified' },
  'race.pending':          { 'zh-CN': '待认证',            'en': 'Pending' },
  'race.leaderboard':      { 'zh-CN': '排行榜',            'en': 'Leaderboard' },
  'race.lbHint':           { 'zh-CN': '选赛道查看',        'en': 'select a track' },
  'race.lbSelect':         { 'zh-CN': '选赛道后查看',      'en': 'Select a track to view' },
  'race.lbEmpty':          { 'zh-CN': '该赛道暂无认证成绩', 'en': 'No verified times on this track yet' },
  'race.noTracks':         { 'zh-CN': '暂无可用赛道',      'en': 'No tracks available' },
  'race.player':           { 'zh-CN': '玩家',              'en': 'Player' },
  'race.col.track':        { 'zh-CN': '赛道',              'en': 'Track' },
  'race.col.time':         { 'zh-CN': '用时',              'en': 'Time' },
  'race.col.kart':         { 'zh-CN': '车型',              'en': 'Vehicle' },
  'race.col.status':       { 'zh-CN': '状态',              'en': 'Status' },
  'race.col.date':         { 'zh-CN': '日期',              'en': 'Date' },
  'race.col.player':       { 'zh-CN': '玩家',              'en': 'Player' },
  'race.col.license':      { 'zh-CN': '驾照',              'en': 'License' },
  'race.err.noTrack':      { 'zh-CN': '请选择赛道',         'en': 'Please select a track' },
  'race.err.badTime':      { 'zh-CN': '用时格式不对 (例 1:23.456 或 83.456 秒)', 'en': 'Bad time format (e.g., 1:23.456 or 83.456 sec)' },
  'race.recorded':         { 'zh-CN': '已记录',            'en': 'Recorded' },
  'race.waitVerify':       { 'zh-CN': '等管理员确认后入榜', 'en': 'will enter the board after admin verifies' },
  // 通知订阅 (profile subscriptions)
  'sub.mySubs':            { 'zh-CN': '我的订阅',          'en': 'My Subscriptions' },
  'sub.enabled':           { 'zh-CN': '个开启',            'en': 'enabled' },
  'sub.type.announcement': { 'zh-CN': '新公告',            'en': 'New Announcements' },
  'sub.type.announcement.desc': { 'zh-CN': '市政厅发布新公告时通知我', 'en': 'Notify me when the city hall publishes a new announcement' },
  'sub.type.reply':        { 'zh-CN': '我的留言被回复',     'en': 'Message Replies' },
  'sub.type.reply.desc':   { 'zh-CN': '我的市民留言被管理员 / AI 回复时通知我', 'en': 'Notify me when an admin or AI replies to my message' },
  'sub.type.dm':           { 'zh-CN': '新私信',            'en': 'New DMs' },
  'sub.type.dm.desc':      { 'zh-CN': '收到新私信时通知我', 'en': 'Notify me when I receive a direct message' },
  'sub.subscribe':         { 'zh-CN': '订阅',              'en': 'Subscribe' },
  'sub.subscribed':        { 'zh-CN': '已订阅',            'en': 'Subscribed' },
  'sub.recentNotifs':      { 'zh-CN': '最近通知',          'en': 'Recent Notifications' },
  'sub.noNotif':           { 'zh-CN': '还没有通知',         'en': 'No notifications yet' },
  'sub.btn.read':          { 'zh-CN': '已读',              'en': 'Read' },
  'sub.read':              { 'zh-CN': '已读',              'en': 'Read' },
  'sub.readAll':           { 'zh-CN': '全部标为已读',      'en': 'Mark All as Read' },
  'common.fail':           { 'zh-CN': '失败',              'en': 'Failed' },
  // 酒店预订 (book.js)
  'hotel.book.badDate':    { 'zh-CN': '请选择有效日期',     'en': 'Please pick valid dates' },
  'hotel.book.outBeforeIn':{ 'zh-CN': '退房日期必须晚于入住日期', 'en': 'Check-out date must be after check-in date' },
  'hotel.book.fillAll':    { 'zh-CN': '请填写姓名和联系方式', 'en': 'Please fill in name and contact' },
  'hotel.book.submitting': { 'zh-CN': '提交中…',           'en': 'Submitting…' },
  'hotel.book.submitted':  { 'zh-CN': '已提交（跨设备同步，管理员会确认）', 'en': 'Submitted (synced, admin will confirm)' },
  'hotel.book.loginFirst': { 'zh-CN': '请先登录玩家账号再预订', 'en': 'Please log in to a player account first' },
  // DM 发起新会话 (list.js)
  'dm.new.usernamePrompt': { 'zh-CN': '收件人用户名（对方必须是已激活的玩家）:', 'en': 'Recipient username (must be an active player):' },
  'dm.new.contentPrompt':  { 'zh-CN': '私信内容：',         'en': 'Message content:' },
  'dm.aiBot.prompt':       { 'zh-CN': '给 AI 客服灯灯留言（100 字以内）：', 'en': 'Message to AI Support (max 100 chars):' },
  // admin 工单派单 modal (替代 prompt)
  'admin.ticket.modal.assignTitle': { 'zh-CN': '派单',     'en': 'Assign' },
  'admin.ticket.unassign': { 'zh-CN': '— 不派单 —',         'en': '— Unassigned —' },
  'admin.ticket.btn.export':{ 'zh-CN': '📥 导出 CSV',         'en': '📥 Export CSV' },
  'admin.ticket.toast.exportEmpty':  { 'zh-CN': '当前列表为空，无可导出数据', 'en': 'List is empty. Nothing to export.' },
  'admin.ticket.toast.exported':     { 'zh-CN': '已导出',           'en': 'Exported' },
  'admin.ticket.toast.exportedUnit': { 'zh-CN': '条工单',           'en': 'tickets' },
  'admin.players.toast.exportEmpty':  { 'zh-CN': '当前列表为空，无可导出数据', 'en': 'List is empty. Nothing to export.' },
  'admin.players.toast.exported':     { 'zh-CN': '已导出',           'en': 'Exported' },
  'admin.players.toast.exportedUnit': { 'zh-CN': '名玩家',           'en': 'players' },
  'admin.dash.lastUpdate':  { 'zh-CN': '数据更新于',         'en': 'Updated at' },
  'admin.dash.refreshTip':  { 'zh-CN': '刷新数据',           'en': 'Refresh data' },
  'wall.sort.label':        { 'zh-CN': '排序：',             'en': 'Sort:' },
  'wall.sort.newest':       { 'zh-CN': '最新',               'en': 'Newest' },
  'wall.sort.oldest':       { 'zh-CN': '最早',               'en': 'Oldest' },
  // admin 玩家批量操作
  'admin.players.batch.selected':  { 'zh-CN': '已选',          'en': 'selected' },
  'admin.players.batch.selectAll': { 'zh-CN': '全选当前页',     'en': 'Select all on this page' },
  'admin.players.batch.approve':   { 'zh-CN': '✓ 批量批准',     'en': '✓ Batch Approve' },
  'admin.players.batch.reject':    { 'zh-CN': '✕ 批量拒绝',     'en': '✕ Batch Reject' },
  'admin.players.batch.clear':     { 'zh-CN': '取消选择',        'en': 'Clear Selection' },
  'admin.players.batch.approveName': { 'zh-CN': '批准',         'en': 'approve' },
  'admin.players.batch.rejectName':  { 'zh-CN': '拒绝',         'en': 'reject' },
  'admin.players.batch.confirm':    { 'zh-CN': '确认批量{act} {n} 个玩家？', 'en': 'Confirm to {act} {n} player(s)?' },
  'admin.players.batch.successUnit':{ 'zh-CN': '已',            'en': 'successfully' },
  'admin.players.batch.failUnit':   { 'zh-CN': '失败',          'en': 'failed' },
  'admin.ann.toast.exportEmpty':   { 'zh-CN': '当前列表为空，无可导出数据', 'en': 'List is empty. Nothing to export.' },
  'admin.ann.toast.exported':      { 'zh-CN': '已导出',         'en': 'Exported' },
  'admin.ann.toast.exportedUnit':  { 'zh-CN': '条公告',         'en': 'announcements' },
  'admin.gallery.toast.exportEmpty':{ 'zh-CN': '当前列表为空，无可导出数据', 'en': 'List is empty. Nothing to export.' },
  'admin.gallery.toast.exported':  { 'zh-CN': '已导出',         'en': 'Exported' },
  'admin.gallery.toast.exportedUnit':{ 'zh-CN': '张图',          'en': 'images' },
  // hero
  'hero.tag':         { 'zh-CN': '灯光市人民政府 · 官方站点', 'en': 'Light City Hall · Official Site' },
  'hero.welcome':     { 'zh-CN': '欢 迎 来 到', 'en': 'WELCOME TO' },
  'hero.cityName':    { 'zh-CN': '灯 光 市', 'en': 'LIGHT CITY' },
  'hero.pinyin':      { 'zh-CN': 'DENG GUANG SHI', 'en': 'A PIXEL CITY OF MC' },
  'hero.desc':        { 'zh-CN': '这里是灯光市人民政府的官方网站。本站用于发布公告、办理市民服务、记录城市数据。具体活动与项目由市政厅筹备，正式上线后在此呈现。',
                         'en': 'Official website of the Light City Hall. Publishes city announcements, handles civic services, and records city data. Activities are prepared by the city hall and presented here once officially launched.' },
  'hero.stat.players':{ 'zh-CN': '注册市民', 'en': 'Citizens' },
  'hero.stat.buildings': { 'zh-CN': '已建建筑', 'en': 'Buildings' },
  'hero.stat.buildings.num': { 'zh-CN': '—', 'en': '—' },
  'hero.stat.founded':{ 'zh-CN': '建市时间', 'en': 'Founded' },
  'hero.stat.founded.num': { 'zh-CN': '2026', 'en': '2026' },
  // section heads
  'section.notice.title':   { 'zh-CN': '📜 市政公告',         'en': '📜 City Bulletin' },
  'section.notice.sub':     { 'zh-CN': 'CITY BULLETIN · 最新动态', 'en': 'CITY BULLETIN · Latest News' },
  'section.data.title':     { 'zh-CN': '📊 城市数据看板',     'en': '📊 City Dashboard' },
  'section.data.sub':       { 'zh-CN': 'CITY DATA · 实时统计', 'en': 'CITY DATA · Live Stats' },
  'section.scenery.title':  { 'zh-CN': '🏙️ 城市风貌',         'en': '🏙️ City Scenery' },
  'section.scenery.sub':    { 'zh-CN': 'CITY SCENERY · 精选实景图', 'en': 'CITY SCENERY · Featured Shots' },
  'section.gallery.title':  { 'zh-CN': '📸 实景图集',         'en': '📸 Photo Gallery' },
  'section.gallery.sub':    { 'zh-CN': 'REAL SHOTS · 灯光市实拍', 'en': 'REAL SHOTS · Light City Photos' },
  'section.wall.title':     { 'zh-CN': '💬 市民留言墙',       'en': '💬 Public Wall' },
  'section.wall.sub':       { 'zh-CN': 'PUBLIC WALL · 大家的留言', 'en': 'PUBLIC WALL · Citizen Messages' },
  'section.kart.title':     { 'zh-CN': '🏎️ 国际赛车场',       'en': '🏎️ Kart Racing' },
  'section.kart.sub':       { 'zh-CN': 'KART RACING · 双车道红石冰道', 'en': 'KART RACING · Two-Lane Redstone Ice' },
  'section.circuit.title':  { 'zh-CN': '🏎️ 国际赛车场',       'en': '🏎️ International Circuit' },
  'section.circuit.sub':    { 'zh-CN': 'INTERNATIONAL CIRCUIT · F1 级专业赛道', 'en': 'INTERNATIONAL CIRCUIT · F1-grade Track' },
  'section.license.title':  { 'zh-CN': '🚗 驾照考试',         'en': '🚗 Driver License' },
  'section.license.sub':    { 'zh-CN': "DRIVER'S LICENSE · B/A/S 三级", 'en': "DRIVER'S LICENSE · B/A/S Tiers" },
  'section.hotel.title':    { 'zh-CN': '🏨 树上酒店',         'en': '🏨 Treehouse Hotel' },
  'section.hotel.sub':      { 'zh-CN': 'TREEHOUSE HOTEL · 住进像素森林', 'en': 'TREEHOUSE HOTEL · Stay in the Pixel Forest' },
  'section.contact.title':  { 'zh-CN': '📬 联系我们',         'en': '📬 Contact Us' },
  'section.contact.sub':    { 'zh-CN': 'CONTACT US · 与市政厅对话', 'en': 'CONTACT US · Talk to City Hall' },
  'flow.title':             { 'zh-CN': '⚙️ 办事流程（草案）', 'en': '⚙️ Service Flow (Draft)' },
  'flow.step1.title':       { 'zh-CN': '在线申请',           'en': 'Apply Online' },
  'flow.step1.desc':        { 'zh-CN': '登录市民账号，填写表单并提交', 'en': 'Log in, fill the form, and submit.' },
  'flow.step2.title':       { 'zh-CN': '市政厅审核',         'en': 'City Hall Review' },
  'flow.step2.desc':        { 'zh-CN': '审核期限与流程由市政厅公告', 'en': 'Review timeline will be announced by the city hall.' },
  'flow.step3.title':       { 'zh-CN': '现场/线上办理',       'en': 'On-site / Online' },
  'flow.step3.desc':        { 'zh-CN': '根据事项类型完成最后一步', 'en': 'Final step depends on the request type.' },
  'flow.step4.title':       { 'zh-CN': '结果送达',           'en': 'Result Delivered' },
  'flow.step4.desc':        { 'zh-CN': '结果以公告、信件或消息方式送达', 'en': 'Result is delivered via announcement, mail, or message.' },
  'flow.note':              { 'zh-CN': '具体办事流程由市政厅随服务上线后正式公告。本栏仅作草案展示。', 'en': 'Final service flow will be officially announced by the city hall when each service goes live. This section is a draft preview.' },
  'circuit.mapTitle':       { 'zh-CN': '—— TRACK MAP / 赛道线路图 ——', 'en': '—— TRACK MAP / Circuit Layout ——' },
  'common.backHome':        { 'zh-CN': 'Home',           'en': 'Home' },
  'common.loading':         { 'zh-CN': '载入中…',        'en': 'Loading…' },
  'footer.col.hotel':       { 'zh-CN': '酒店',            'en': 'Hotel' },
  'footer.col.admin':       { 'zh-CN': '管理',            'en': 'Admin' },
  'nav.brand':              { 'zh-CN': '灯光市',          'en': 'Light City' },
  // sub-page 顶 nav (hotel/profile/dm 共用)
  'subnav.loginFirst':      { 'zh-CN': '返回首页登录',    'en': 'Return to login' },
  'subnav.adminPanel':      { 'zh-CN': '管理后台',        'en': 'Admin' },
  'subnav.notif':           { 'zh-CN': '通知',            'en': 'Notifications' },
  'subnav.dm':              { 'zh-CN': '私信',            'en': 'DM' },
  'subnav.profile':         { 'zh-CN': '主页',            'en': 'Profile' },
  'subnav.myProfile':       { 'zh-CN': '我的主页',        'en': 'My Profile' },
  'subnav.logout':          { 'zh-CN': '登出',            'en': 'Logout' },
  // hotel 房型卡 UI
  'hotel.badge.recommend':  { 'zh-CN': '推荐',            'en': 'Featured' },
  'hotel.badge.building':   { 'zh-CN': '筹建中',          'en': 'Under Construction' },
  'hotel.bedLabel':         { 'zh-CN': '床型',            'en': 'Beds' },
  'hotel.guestsLabel':      { 'zh-CN': '适合',            'en': 'Fits' },
  'hotel.perNight':         { 'zh-CN': '晚',              'en': 'night' },
  'hotel.price.tbd':        { 'zh-CN': '价格待定',         'en': 'Price TBD' },
  'hotel.btn.detail':       { 'zh-CN': '详情',            'en': 'Details' },
  'hotel.btn.book':         { 'zh-CN': '预订',            'en': 'Book' },
  'hotel.btn.unavailable':  { 'zh-CN': '暂不开放',         'en': 'Not Available' },
  'hotel.detail.hotel':     { 'zh-CN': '所属酒店',         'en': 'Hotel' },
  'hotel.detail.price':     { 'zh-CN': '价格',            'en': 'Price' },
  'common.person':          { 'zh-CN': '人',              'en': 'guests' },
  'common.perTrial':        { 'zh-CN': '次',              'en': 'trial' },
  'common.minutes':         { 'zh-CN': '分钟',            'en': 'min' },
  'common.minAge':          { 'zh-CN': '最低',            'en': 'Min' },
  'common.yearsOld':        { 'zh-CN': '岁',              'en': 'yrs old' },
  'license.gradeSuffix':    { 'zh-CN': '级',              'en': 'Tier' },
  'license.btn.signup':     { 'zh-CN': '报名',            'en': 'Apply' },
  'license.btn.examSuffix': { 'zh-CN': '级考试',          'en': 'Exam' },
  'profile.stat.days':      { 'zh-CN': '天',              'en': 'Days' },
  'profile.stat.daysTip':   { 'zh-CN': '从注册日算起',     'en': 'Days since joining' },
  // 纪念勋章 (加入天数里程碑)
  'profile.badge.sprout':   { 'zh-CN': '萌芽',            'en': 'Sprout' },
  'profile.badge.settled':  { 'zh-CN': '落户',            'en': 'Settled' },
  'profile.badge.veteran':  { 'zh-CN': '老市民',          'en': 'Veteran' },
  'profile.badge.pioneer':  { 'zh-CN': '元老',            'en': 'Pioneer' },
  'profile.badge.sprout.tip':  { 'zh-CN': '加入满 7 天',    'en': '7 days in the city' },
  'profile.badge.settled.tip': { 'zh-CN': '加入满 30 天',   'en': '30 days in the city' },
  'profile.badge.veteran.tip': { 'zh-CN': '加入满 100 天',  'en': '100 days in the city' },
  'profile.badge.pioneer.tip': { 'zh-CN': '加入满 365 天',  'en': '365 days in the city' },
  // admin 后台概览 stat 卡
  'admin.stat.playerPending':   { 'zh-CN': '待审玩家',  'en': 'Pending Players' },
  'admin.stat.msgUnread':       { 'zh-CN': '未读留言',  'en': 'Unread Messages' },
  'admin.stat.bookPending':     { 'zh-CN': '待审酒店',  'en': 'Pending Bookings' },
  'admin.stat.licensePending':  { 'zh-CN': '待审驾照',  'en': 'Pending Licenses' },
  'admin.stat.kartPending':     { 'zh-CN': '待审赛道',  'en': 'Pending Karts' },
  'admin.stat.playerActive':    { 'zh-CN': '活跃市民',  'en': 'Active Citizens' },
  // admin 工单 status filter
  'admin.ticket.filter.all':       { 'zh-CN': '📌 全部状态',  'en': '📌 All Status' },
  'admin.ticket.filter.open':      { 'zh-CN': '⏳ 待处理',   'en': '⏳ Open' },
  'admin.ticket.filter.inProgress':{ 'zh-CN': '🔄 处理中',   'en': '🔄 In Progress' },
  'admin.ticket.filter.resolved':  { 'zh-CN': '✓ 已解决',    'en': '✓ Resolved' },
  'admin.ticket.filter.closed':    { 'zh-CN': '✕ 已关闭',    'en': '✕ Closed' },
  // admin 工单 category filter
  'admin.ticket.cat.all':       { 'zh-CN': '📂 全部类型',  'en': '📂 All Types' },
  'admin.ticket.cat.message':   { 'zh-CN': '💬 留言',     'en': '💬 Message' },
  'admin.ticket.cat.comment':   { 'zh-CN': '💭 评论',     'en': '💭 Comment' },
  'admin.ticket.cat.license':   { 'zh-CN': '🚗 驾照',     'en': '🚗 License' },
  'admin.ticket.cat.hotel':     { 'zh-CN': '🏨 酒店',     'en': '🏨 Hotel' },
  'admin.ticket.cat.race':      { 'zh-CN': '🏁 赛车',     'en': '🏁 Race' },
  'admin.ticket.cat.kart':      { 'zh-CN': '🛞 卡丁车',   'en': '🛞 Kart' },
  'admin.ticket.cat.service':   { 'zh-CN': '🛎️ 服务',     'en': '🛎️ Service' },
  'admin.ticket.empty':        { 'zh-CN': '暂无工单',      'en': 'No tickets yet' },
  'admin.ticket.hint':     { 'zh-CN': '统一处理所有市民事务：留言 / 酒店预订 / 驾照报名 / 赛道报名 / 玩家主动服务请求。按分类筛选 + 模糊搜索 + 状态流转 (待处理 → 处理中 → 已解决 → 关闭)。',
                              'en': 'Unified inbox for all citizen requests: messages, hotel bookings, license signups, race signups, and direct service requests. Filter by category, fuzzy-search, and move tickets through the workflow (Open → In Progress → Resolved → Closed).' },
  'hotel.intro':            { 'zh-CN': '树上酒店（筹建）。选址、规模、定价、运营方由市民大会与合作社讨论后公布。当前展示房型为草案，待合作社定稿后正式上线。',
                               'en': 'Treehouse Hotel (under construction). Site, scale, pricing, and operator will be decided by the Citizens Assembly and the cooperative. Room listings shown are drafts and will go live once finalized.' },
  // hotel 排序 + 人数/景观 filter
  'hotel.sort.label':       { 'zh-CN': '排序：',         'en': 'Sort:' },
  'hotel.sort.default':     { 'zh-CN': '默认',           'en': 'Default' },
  'hotel.sort.priceAsc':    { 'zh-CN': '价格升序',        'en': 'Price ↑' },
  'hotel.sort.priceDesc':   { 'zh-CN': '价格降序',        'en': 'Price ↓' },
  'hotel.sort.guestsDesc':  { 'zh-CN': '容量降序',        'en': 'Guests ↓' },
  'hotel.guests.1':         { 'zh-CN': '1 人',           'en': '1 guest' },
  'hotel.guests.2':         { 'zh-CN': '2 人',           'en': '2 guests' },
  'hotel.guests.3':         { 'zh-CN': '3+ 人',          'en': '3+ guests' },
  'hotel.view.window':      { 'zh-CN': '窗外',           'en': 'Window' },
  'hotel.view.scenery':     { 'zh-CN': '景观',           'en': 'Scenery' },
  'admin.ann.btn.edit':     { 'zh-CN': '编辑',            'en': 'Edit' },
  'admin.ann.btn.delete':   { 'zh-CN': '删除',            'en': 'Delete' },
  'common.backTop':         { 'zh-CN': '回到顶部',         'en': 'Back to Top' },
  // 公告卡 UI 标签
  'ann.tag.latest':         { 'zh-CN': '最新',           'en': 'Latest' },
  'ann.tag.normal':         { 'zh-CN': '公告',           'en': 'Notice' },
  'ann.meta.edited':        { 'zh-CN': '已编辑',         'en': 'Edited' },
  'ann.meta.author':        { 'zh-CN': '市政厅',         'en': 'City Hall' },
  'ann.readMore':           { 'zh-CN': '阅读全文 →',     'en': 'Read more →' },
  'ann.coverAlt':           { 'zh-CN': '公告配图',       'en': 'Notice cover image' },
  'common.close':           { 'zh-CN': '关闭',           'en': 'Close' },
  // 主页 hero CTA
  'hero.cta.notice':  { 'zh-CN': '▶ 查看公告', 'en': '▶ View Notice' },
  'hero.cta.service': { 'zh-CN': '市民服务',   'en': 'Civic Service' },
  // 列表 3 态文案 (N5 Step 15: loading/empty/error 全 i18n)
  'common.refresh':       { 'zh-CN': '刷新',             'en': 'Refresh' },
  'common.error.render':  { 'zh-CN': '渲染失败',         'en': 'Render failed' },
  'common.error.load':    { 'zh-CN': '加载失败',         'en': 'Load failed' },
  'auth.needLogin':        { 'zh-CN': '请先登录',         'en': 'Please log in first' },
  'auth.login.title':      { 'zh-CN': '玩家登录',         'en': 'Player Login' },
  'auth.login.submit':     { 'zh-CN': '登录',            'en': 'Sign In' },
  'auth.login.loading':     { 'zh-CN': '登录中...',        'en': 'Signing in...' },
  'auth.register.title':   { 'zh-CN': '注册玩家账号',       'en': 'Create Player Account' },
  'auth.register.submit':  { 'zh-CN': '注册并登录',        'en': 'Sign Up & Log In' },
  'auth.register.loading': { 'zh-CN': '注册中...',        'en': 'Signing up...' },
  'auth.err.empty':        { 'zh-CN': '请填写用户名和密码',   'en': 'Please fill in username and password' },
  'auth.err.email':        { 'zh-CN': '请填写邮箱',         'en': 'Please enter your email' },
  'auth.err.isAdmin':      { 'zh-CN': '这是管理员账号，请去 /admin.html 登录', 'en': 'This is an admin account — log in at /admin.html' },
  'auth.err.network':      { 'zh-CN': '网络错误：',          'en': 'Network error: ' },
  'auth.success':          { 'zh-CN': '✓ 成功！',            'en': '✓ Success!' },
  'auth.register.pendingMsg':{ 'zh-CN': '注册申请已提交，等审批', 'en': 'Signup submitted, awaiting approval' },
  'passkey.btn.unsupported':  { 'zh-CN': '⚠ 当前浏览器不支持通行密钥', 'en': '⚠ Browser does not support passkey' },
  'passkey.btn.needHttps':    { 'zh-CN': '⚠ 需要 HTTPS 安全连接',     'en': '⚠ HTTPS required' },
  'passkey.btn.preparing':    { 'zh-CN': '⏳ 准备中...',           'en': '⏳ Preparing...' },
  'passkey.tip.unsupported':  { 'zh-CN': '请用最新版 Chrome / Safari / Edge 桌面端主浏览器', 'en': 'Use latest Chrome / Safari / Edge on desktop' },
  'passkey.tip.needHttps':    { 'zh-CN': '请直接在 https://dengguang-city.pages.dev 打开 (非内嵌)', 'en': 'Open https://dengguang-city.pages.dev directly (not iframe)' },
  'passkey.alert.unsupported':{ 'zh-CN': '您的浏览器不支持通行密钥 (WebAuthn)。\n\n请用最新版 Chrome / Safari / Edge 桌面端。', 'en': 'Your browser does not support passkey (WebAuthn).\n\nPlease use the latest Chrome / Safari / Edge on desktop.' },
  'passkey.alert.needHttps':  { 'zh-CN': '通行密钥需要 HTTPS 安全连接。',     'en': 'Passkey requires an HTTPS connection.' },
  'passkey.btn.touch':        { 'zh-CN': '⏳ 请触摸指纹/Face ID...',  'en': '⏳ Touch fingerprint / Face ID...' },
  'passkey.btn.verifying':    { 'zh-CN': '⏳ 验证中...',            'en': '⏳ Verifying...' },
  'passkey.loginSuccess':     { 'zh-CN': '✓ 通行密钥登录成功！',     'en': '✓ Passkey login successful!' },
  'passkey.loginFailPrefix':  { 'zh-CN': '✗ 通行密钥失败: ',        'en': '✗ Passkey failed: ' },
  'passkey.offer.title':      { 'zh-CN': '欢迎！要不要顺便注册通行密钥？', 'en': 'Welcome! Want to register a passkey?' },
  'passkey.offer.sub':        { 'zh-CN': '下次可指纹 / Face ID 一键登录，不用记密码', 'en': 'Next time, sign in with fingerprint / Face ID — no password needed' },
  'passkey.offer.addBtn':     { 'zh-CN': '✅ 立即添加到通行密钥',   'en': '✅ Add passkey now' },
  'passkey.offer.laterBtn':   { 'zh-CN': '⏭ 下次再说',             'en': '⏭ Later' },
  'passkey.offer.added':      { 'zh-CN': '✓ 已添加！下次直接用指纹/Face ID 登录。', 'en': '✓ Added! Next time sign in with fingerprint / Face ID.' },
  'passkey.offer.cancelled':  { 'zh-CN': '已取消 (没添加成功, 下次可再来)', 'en': 'Cancelled (not added, you can try again later)' },
  'auth.err.timeout':         { 'zh-CN': '✗ 操作超时, 请重试',      'en': '✗ Timed out, please retry' },
  'auth.err.cancelled':       { 'zh-CN': '已取消, 请重试',          'en': 'Cancelled, please retry' },
  'auth.err.noCredential':    { 'zh-CN': '未获得凭据 (设备无注册密钥?)', 'en': 'No credential (no passkey on this device?)' },
  'auth.err.verifyFail':      { 'zh-CN': '验证失败',                'en': 'Verification failed' },
  'auth.err.insecureCtx':     { 'zh-CN': '环境不安全 (需要 HTTPS)', 'en': 'Insecure context (HTTPS required)' },
  'nav.prefillTitle':     { 'zh-CN': '已用你的游戏ID自动填写（市政厅要求：留言姓名 = 注册用户名）', 'en': 'Auto-filled with your in-game ID (per City Hall policy: message name = registered username)' },
  'nav.admin':            { 'zh-CN': '管理后台',            'en': 'Admin' },
  'nav.emeraldTip':       { 'zh-CN': '绿宝石余额',          'en': 'Emerald balance' },
  'nav.signinTip':        { 'zh-CN': '每日签到领绿宝石',     'en': 'Daily sign-in for emeralds' },
  'nav.signin':           { 'zh-CN': '签到',               'en': 'Sign in' },
  'nav.notif':            { 'zh-CN': '通知',               'en': 'Notifications' },
  'nav.dm':               { 'zh-CN': '私信',               'en': 'DM' },
  'nav.annNew':           { 'zh-CN': '新',                 'en': 'New' },
  'nav.logout':           { 'zh-CN': '登出',               'en': 'Log out' },
  'citizen.card.title':   { 'zh-CN': '灯光市 · 市民卡',     'en': 'Light City · Citizen Card' },
  'citizen.card.joined':   { 'zh-CN': '入驻: ',              'en': 'Joined: ' },
  'citizen.card.emeralds':{ 'zh-CN': '绿宝石',             'en': 'Emeralds' },
  'citizen.card.years':   { 'zh-CN': '服务年数',            'en': 'Years' },
  'citizen.card.role':    { 'zh-CN': '身份',               'en': 'Role' },
  'signin.title':             { 'zh-CN': '每日签到',            'en': 'Daily Sign-in' },
  'signin.emeralds':          { 'zh-CN': '当前绿宝石',          'en': 'Current Emeralds' },
  'signin.streak':            { 'zh-CN': '连续 / 总',           'en': 'Streak / Total' },
  'signin.days':              { 'zh-CN': '天',                 'en': 'days' },
  'signin.recent7':           { 'zh-CN': '最近 7 天',           'en': 'Last 7 days' },
  'signin.rules.title':       { 'zh-CN': '奖励规则: 7 天一个循环', 'en': 'Reward cycle: 7 days' },
  'signin.rules.detail':      { 'zh-CN': '第 1 天 +1 💎 · 第 2 天 +2 · ... · 第 7 天 +7 💎', 'en': 'Day 1: +1 💎 · Day 2: +2 · ... · Day 7: +7 💎' },
  'signin.rules.cycle':       { 'zh-CN': '第 8 天重新从 +1 开始 (一周循环往复)', 'en': 'Day 8 starts again at +1 (loops weekly)' },
  'signin.btn.doSignin':      { 'zh-CN': '🎁 签到领绿宝石',     'en': '🎁 Sign in for Emeralds' },
  'signin.btn.signedToday':   { 'zh-CN': '✓ 今日已签, 明天再来',  'en': '✓ Signed today, see you tomorrow' },
  'signin.badge.signedToday': { 'zh-CN': '✓ 今日已签',          'en': '✓ Signed today' },
  'signin.loading':           { 'zh-CN': '签到中…',            'en': 'Signing in...' },
  'signin.streakBonus':       { 'zh-CN': ' (连签奖励!)',         'en': ' (streak bonus!)' },
  'signin.err.statusFail':    { 'zh-CN': '签到状态查询失败',      'en': 'Failed to fetch sign-in status' },
  'signin.err.needLogin':     { 'zh-CN': '请先在右上角登录市民账号, 再来签到', 'en': 'Log in first (top-right) to sign in' },
  'signin.err.network':       { 'zh-CN': '网络错误: ',          'en': 'Network error: ' },
  'signin.err.fail':          { 'zh-CN': '签到失败',            'en': 'Sign-in failed' },
  'common.empty':         { 'zh-CN': '暂无数据',         'en': 'No data' },
  'hotel.empty.filtered': { 'zh-CN': '没有符合条件的房型，试试调整筛选条件。', 'en': 'No matching rooms. Try adjusting filters.' },
  'messages.empty':       { 'zh-CN': '暂无留言, 来抢沙发', 'en': 'No messages yet. Be the first!' },
  'messages.empty.comments': { 'zh-CN': '暂无评论, 来抢沙发', 'en': 'No comments yet. Be the first!' },
  'gallery.empty':        { 'zh-CN': '暂无图集',         'en': 'No gallery items' },
  // admin 面板 HTML 内可见文案
  'admin.admins.title':   { 'zh-CN': '管理员账号',        'en': 'Admin Accounts' },
  'admin.admins.add':      { 'zh-CN': '+ 添加管理员',      'en': '+ Add Admin' },
  'admin.admins.empty':    { 'zh-CN': '暂无管理员',        'en': 'No admin accounts' },
  'admin.players.title':   { 'zh-CN': '玩家管理',          'en': 'Player Management' },
  'admin.players.pending':  { 'zh-CN': '待审批',            'en': 'Pending' },
  'admin.players.active':   { 'zh-CN': '已激活',            'en': 'Active' },
  'admin.players.rejected': { 'zh-CN': '已拒绝',            'en': 'Rejected' },
  'admin.players.all':      { 'zh-CN': '全部',              'en': 'All' },
  'admin.players.empty':    { 'zh-CN': '暂无玩家',          'en': 'No players' },
  'admin.kart.title':      { 'zh-CN': '赛道试跑报名',      'en': 'Kart Signups' },
  'admin.kart.clearDone':  { 'zh-CN': '清除已处理',        'en': 'Clear Done' },
  'admin.kart.signup':     { 'zh-CN': '赛道报名',          'en': 'Signups' },
  'admin.kart.status.pending':  { 'zh-CN': '待审核',    'en': 'Pending' },
  'admin.kart.status.approved': { 'zh-CN': '已批准',    'en': 'Approved' },
  'admin.kart.status.rejected': { 'zh-CN': '已拒绝',    'en': 'Rejected' },
  'admin.kart.signup.empty':    { 'zh-CN': '暂无报名',  'en': 'No signups' },
  'admin.kart.manage.empty':   { 'zh-CN': '暂无赛车场。点右上"新建赛车场"创建。', 'en': 'No karting tracks yet. Click "+ New Track" above.' },
  'admin.kart.manage.add':      { 'zh-CN': '新建赛车场', 'en': 'New Track' },
  'admin.kart.session.all':     { 'zh-CN': '全部场次',   'en': 'All Sessions' },
  'admin.kart.session.timingSat':  { 'zh-CN': '周六 14:00 计时赛', 'en': 'Sat 14:00 Timed Run' },
  'admin.kart.session.relaySat':   { 'zh-CN': '周六 20:00 接力赛', 'en': 'Sat 20:00 Relay Race' },
  'admin.kart.session.teachSun':   { 'zh-CN': '周日 10:00 教学场', 'en': 'Sun 10:00 Training' },
  'admin.kart.session.other':       { 'zh-CN': '其他时间',            'en': 'Other times' },
  'admin.circuit.session.pole':     { 'zh-CN': '排位赛 周三 20:00',   'en': 'Qualifying Wed 20:00' },
  'admin.circuit.session.raceSat':  { 'zh-CN': '正赛 周六 15:00',     'en': 'Race Sat 15:00' },
  'admin.circuit.session.invite':  { 'zh-CN': '国际邀请赛 月初',     'en': 'Intl Invitational (month-start)' },
  'admin.circuit.session.practice':{ 'zh-CN': '自由练习',            'en': 'Free Practice' },
  'admin.circuit.license.all':  { 'zh-CN': '全部驾照',   'en': 'All Licenses' },
  'admin.kart.circuit':   { 'zh-CN': '国际试车',          'en': 'Circuit' },
  'admin.kart.manage':     { 'zh-CN': '赛车场管理',          'en': 'Karting Mgmt' },
  'admin.dms.title':       { 'zh-CN': '私信监管',          'en': 'DM Monitor' },
  'admin.dms.hint':        { 'zh-CN': '监管所有玩家私信对话，可以灯灯客服身份代为回复，或查看 AI 客服"转人工"建议的对话。', 'en': 'Monitor all player DM conversations. Reply as DengDeng or review conversations flagged for human handoff.' },
  'admin.dms.empty':       { 'zh-CN': '暂无私信记录',      'en': 'No DM records' },
  'admin.gallery.title':   { 'zh-CN': '首页图集管理',      'en': 'Gallery Management' },
  'admin.gallery.hint':    { 'zh-CN': '管理首页"城市风貌"和"实景图集"栏目用的所有图片。修改后, 首页 index.html 会立即拉新版本。', 'en': 'Manage all images used in the "Scenery" and "Photo Gallery" sections on the homepage.' },
  'admin.gallery.createBtn':{ 'zh-CN': '+ 添加图片',       'en': '+ Add Image' },
  'admin.gallery.empty':   { 'zh-CN': '暂无图片，点右上"+ 添加图片"开始', 'en': 'No images yet. Click "+ Add Image" to start.' },
  'admin.gallery.filter.all':   { 'zh-CN': '全部',  'en': 'All' },
  'admin.gallery.filter.city':  { 'zh-CN': '城市',  'en': 'City' },
  'admin.gallery.filter.road':  { 'zh-CN': '路网',  'en': 'Road' },
  'admin.gallery.filter.kart':  { 'zh-CN': '赛道',  'en': 'Kart' },
  'admin.gallery.filter.nature':{ 'zh-CN': '自然',  'en': 'Nature' },
  'admin.pwd.title':       { 'zh-CN': '修改我的密码',      'en': 'Change My Password' },
  'admin.pwd.current':     { 'zh-CN': '当前密码',          'en': 'Current Password' },
  'admin.pwd.new':        { 'zh-CN': '新密码（至少 8 位）', 'en': 'New Password (min 8 chars)' },
  'admin.pwd.confirm':    { 'zh-CN': '确认新密码',         'en': 'Confirm New Password' },
  'admin.pwd.submit':     { 'zh-CN': '更新密码',           'en': 'Update Password' },
  'announcements.admin.empty': { 'zh-CN': '暂无公告，点右上"+ 发布新公告"创建第一条', 'en': 'No announcements yet. Click "+ New Announcement" above.' },
  'admin.gallery.add':    { 'zh-CN': '添加图片',          'en': 'Add Image' },
  'admin.mergeNotice':     { 'zh-CN': '酒店预订、留言、驾照报名已统一合并到"🎫 工单" tab，请到那里处理。', 'en': 'Hotel bookings, messages, and license signups have been merged into the 🎫 Tickets tab.' },
  'admin.jumpToTickets':   { 'zh-CN': '🎫 跳到工单',      'en': '🎫 Go to Tickets' },
  'announcements.empty':  { 'zh-CN': '暂无公告',         'en': 'No announcements' },
  'exam.empty':           { 'zh-CN': '驾照考试暂未开放, 市政厅公告后启动。', 'en': 'License exam not open yet. Will start after city hall notice.' },
  'track.empty':          { 'zh-CN': '暂无开放赛道',     'en': 'No open tracks' },
  'track.price.loadFail': { 'zh-CN': '试车价格加载失败',  'en': 'Failed to load trial price' },
  // v50-N6 (C1): 玩家榜单
  'board.tab.messages':  { 'zh-CN': '💬 留言数榜 · 最活跃市民', 'en': '💬 Most Active Citizens' },
  'board.tab.bookings':  { 'zh-CN': '🏨 酒店预订榜 · 最常出游', 'en': '🏨 Top Travelers' },
  'board.tab.licenses':  { 'zh-CN': '🚗 驾照等级榜 · 老司机',    'en': '🚗 License Holders' },
  'board.unit.messages': { 'zh-CN': '条',  'en': '' },
  'board.unit.bookings': { 'zh-CN': '次',  'en': '' },
  'board.unit.licenses': { 'zh-CN': '级',  'en': '' },
  'board.empty':         { 'zh-CN': '暂无玩家上榜',     'en': 'No players on the board yet' },
  'page.sub.leaderboard':{ 'zh-CN': 'LEADERBOARD · 看谁是灯光市最活跃的市民', 'en': 'LEADERBOARD · Top contributors of Light City' },
  // v50-N6 (C2): 通知中心
  'nav.notifications':  { 'zh-CN': '🔔 通知',           'en': '🔔 Notifications' },
  'notif.filter.all':         { 'zh-CN': '全部',         'en': 'All' },
  'notif.filter.unread':      { 'zh-CN': '未读',         'en': 'Unread' },
  'notif.filter.reply':       { 'zh-CN': '💬 留言回复',  'en': '💬 Replies' },
  'notif.filter.dm':          { 'zh-CN': '✉️ 私信',      'en': '✉️ DMs' },
  'notif.filter.announcement':{ 'zh-CN': '📢 公告',      'en': '📢 Announcements' },
  'notif.readAll':            { 'zh-CN': '✓ 全部已读',   'en': '✓ Mark all read' },
  'notif.unreadCount':        { 'zh-CN': '条未读',       'en': 'unread' },
  'notif.allRead':            { 'zh-CN': '全部已读',     'en': 'All caught up' },
  'notif.empty':              { 'zh-CN': '暂无通知',     'en': 'No notifications' },
  'notif.untitled':           { 'zh-CN': '(无标题)',     'en': '(No title)' },
  'notif.open':               { 'zh-CN': '查看',         'en': 'Open' },
  'notif.read':               { 'zh-CN': '✓ 已读',       'en': '✓ Mark read' },
  'notif.readAllDone':        { 'zh-CN': '已全部标为已读', 'en': 'All marked as read' },
  'notif.readAllFail':        { 'zh-CN': '操作失败: ',  'en': 'Failed: ' },
  'page.sub.notifications':   { 'zh-CN': 'NOTIFICATIONS · 所有留言回复 / DM / 公告推送', 'en': 'NOTIFICATIONS · All replies / DMs / announcements' },
  // v50-N6 (B6-extend): admin 工单 tab 标签
  'admin.ticket.cat.message':    { 'zh-CN': '💬 留言',      'en': '💬 Message' },
  'admin.ticket.cat.comment':    { 'zh-CN': '💭 评论',      'en': '💭 Comment' },
  'admin.ticket.cat.license':    { 'zh-CN': '🚗 驾照',     'en': '🚗 License' },
  'admin.ticket.cat.hotel':     { 'zh-CN': '🏨 酒店',     'en': '🏨 Hotel' },
  'admin.ticket.cat.race':      { 'zh-CN': '🏁 赛车',     'en': '🏁 Race' },
  'admin.ticket.cat.kart':      { 'zh-CN': '🛞 卡丁车',   'en': '🛞 Kart' },
  'admin.ticket.cat.service':   { 'zh-CN': '🛎️ 服务',    'en': '🛎️ Service' },
  'admin.ticket.status.open':       { 'zh-CN': '待处理',     'en': 'Open' },
  'admin.ticket.status.in_progress': { 'zh-CN': '处理中',   'en': 'In Progress' },
  'admin.ticket.status.resolved':   { 'zh-CN': '已解决',   'en': 'Resolved' },
  'admin.ticket.status.closed':     { 'zh-CN': '已关闭',   'en': 'Closed' },
  'admin.ticket.priority.low':    { 'zh-CN': '低',       'en': 'Low' },
  'admin.ticket.priority.normal':  { 'zh-CN': '普通',     'en': 'Normal' },
  'admin.ticket.priority.high':   { 'zh-CN': '高',       'en': 'High' },
  'admin.ticket.priority.urgent': { 'zh-CN': '紧急',     'en': 'Urgent' },
  'admin.ticket.btn.reply':        { 'zh-CN': '💬 回复',          'en': '💬 Reply' },
  'admin.ticket.btn.editReply':   { 'zh-CN': '✎ 编辑回复',       'en': '✎ Edit Reply' },
  'admin.ticket.btn.progress':    { 'zh-CN': '→ 处理中',        'en': '→ In Progress' },
  'admin.ticket.btn.close':       { 'zh-CN': '关闭',             'en': 'Close' },
  'admin.ticket.btn.reopen':      { 'zh-CN': '↺ 重新打开',      'en': '↺ Reopen' },
  'admin.ticket.btn.assign':      { 'zh-CN': '👤 派单',         'en': '👤 Assign' },
  'admin.ticket.adminReply':      { 'zh-CN': '管理员回复',       'en': 'Admin Reply' },
  'admin.ticket.assignLabel':     { 'zh-CN': '派单:',           'en': 'Assign:' },
  'admin.ticket.sourceLabel':     { 'zh-CN': '📂 来源',         'en': '📂 Source' },
  'admin.ticket.anonymous':        { 'zh-CN': '匿名',           'en': 'Anonymous' },
  'admin.ticket.modal.replyTitle': { 'zh-CN': '💬 回复工单',    'en': '💬 Reply to Ticket' },
  'admin.ticket.modal.replyPlaceholder': { 'zh-CN': '回复内容...', 'en': 'Reply...' },
  'admin.ticket.modal.replyHint':   { 'zh-CN': '回复后自动将状态改为"已解决"', 'en': 'Status will auto-change to Resolved after reply' },
  'admin.ticket.modal.cancel':       { 'zh-CN': '取消',         'en': 'Cancel' },
  'admin.ticket.modal.submit':       { 'zh-CN': '提交',         'en': 'Submit' },
  'admin.ticket.assignPrompt':     { 'zh-CN': '派单给 admin (输入 admin id, 留空取消派单)', 'en': 'Assign to admin (enter admin id, blank to unassign)' },
  'admin.ticket.assignCurrent':   { 'zh-CN': '当前:',         'en': 'Current:' },
  'admin.ticket.toast.replyEmpty': { 'zh-CN': '回复内容不能为空', 'en': 'Reply cannot be empty' },
  'admin.ticket.toast.replied':    { 'zh-CN': '已回复',        'en': 'Reply sent' },
  'admin.ticket.toast.updated':    { 'zh-CN': '已更新为 ',      'en': 'Updated to ' },
  'admin.ticket.toast.assigned':   { 'zh-CN': '已更新派单',     'en': 'Assignment updated' },
  'admin.ticket.toast.fail':       { 'zh-CN': '失败: ',        'en': 'Failed: ' },
};

let _current = (function () {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (e) { /* localStorage 不可用 */ }
  return SUPPORTED[0];
})();

export function getLang() { return _current; }
export function getSupported() { return SUPPORTED.slice(); }

// 切换语言 (立即同步到 DOM + localStorage)
export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  if (lang === _current) return true;
  _current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  document.documentElement.lang = lang;
  applyToDOM();
  // 触发自定义事件, 让其他模块 (主题/通知) 知道语言变了
  window.dispatchEvent(new CustomEvent('lc:langchange', { detail: { lang } }));
  return true;
}

// 单 key 翻译
export function t(key, fallback) {
  const entry = DICT[key];
  if (!entry) return fallback !== undefined ? fallback : key;
  return entry[_current] || entry[SUPPORTED[0]] || fallback || key;
}

// 格式化翻译 (支持 {var} 占位符)
// 用法: tf('hotel.count', {n: 3, total: 3})
export function tf(key, vars) {
  let s = t(key);
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp('\\$\\{' + k + '\\}', 'g'), String(vars[k]));
    }
  }
  return s;
}

// 翻译并设置 document.title (页面 title 标签)
// 用法: setPageTitle('page.title.home') 或 '灯光市人民政府 | Light City Hall of MC' (传 zh 直接)
export function setPageTitle(keyOrZh, en) {
  if (!keyOrZh) return;
  if (_current === 'en' && en) {
    document.title = en;
  } else if (keyOrZh.includes('.') && DICT[keyOrZh]) {
    document.title = t(keyOrZh);
  } else {
    document.title = keyOrZh;
  }
  _onLangChangeOnce('page-title', () => setPageTitle(keyOrZh, en));
}

// 翻译并设置 <meta name="description"> 标签
// 用法: setMetaDescription('page.meta.home') 或 '灯光市...' (直接传中文)
export function setMetaDescription(keyOrZh, en) {
  if (!keyOrZh) return;
  const el = document.querySelector('meta[name="description"]');
  if (!el) return;
  const apply = () => {
    if (_current === 'en' && en) el.setAttribute('content', en);
    else if (keyOrZh.includes('.') && DICT[keyOrZh]) el.setAttribute('content', t(keyOrZh));
    else el.setAttribute('content', keyOrZh);
  };
  apply();
  _onLangChangeOnce('meta-desc', () => setMetaDescription(keyOrZh, en));
}

// 内部: 注册一次性的 lc:langchange 监听 (按 key 去重, 避免累积)
const _langListeners = new Map();
function _onLangChangeOnce(key, fn) {
  // 用 key + fn 一起做唯一性, 同 key 第二次调用先 remove 旧 fn 再 add 新 fn
  const existing = _langListeners.get(key);
  if (existing) window.removeEventListener('lc:langchange', existing);
  window.addEventListener('lc:langchange', fn);
  _langListeners.set(key, fn);
}

// 批量翻译 (用于渲染列表)
export function tAll(key) {
  const entry = DICT[key];
  return entry || null;
}

// 扫描 DOM 自动应用 data-i18n
function applyToDOM() {
  const els = document.querySelectorAll('[data-i18n]');
  els.forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, el.textContent);
  });
  // title 属性也支持
  const titleEls = document.querySelectorAll('[data-i18n-title]');
  titleEls.forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, el.title);
  });
  // aria-label 属性也支持 (v50-N6: a11y)
  const ariaEls = document.querySelectorAll('[data-i18n-aria]');
  ariaEls.forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    el.setAttribute('aria-label', t(key, el.getAttribute('aria-label') || ''));
  });
  // placeholder 属性也支持
  const phEls = document.querySelectorAll('[data-i18n-placeholder]');
  phEls.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key, el.placeholder);
  });
}

// 初始化 (DOMContentLoaded 时由调用方触发, 也可手动)
export function initI18n() {
  document.documentElement.lang = _current;
  // 等 DOM 完后再 apply
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToDOM);
  } else {
    applyToDOM();
  }
}

// 渲染语言切换按钮 (返回 HTML 字符串, 调用方决定位置)
// 按钮文字 = '🌐 EN' (在中文页) 或 '🌐 中文' (在英文页), 直观告诉用户点它会切到哪
export function renderLangSwitcher() {
  const otherLabel = _current === 'zh-CN' ? '🌐 EN' : '🌐 中文';
  return `<button type="button" class="nav-lang-switch" id="navLangSwitch" data-lang-toggle="1" title="${otherLabel === '🌐 EN' ? '切换到 English' : 'Switch to 中文'}">${otherLabel}</button>`;
}

// 绑定切换按钮事件 (页面加载后调一次)
export function bindLangSwitcher(root = document) {
  const btn = root.querySelector('#navLangSwitch');
  if (!btn) return;
  // 切换时刷新按钮文字 (切到 en → 显示 '🌐 中文' 让用户知道点它回中文)
  const refreshLabel = () => {
    const otherLabel = _current === 'zh-CN' ? '🌐 EN' : '🌐 中文';
    btn.textContent = otherLabel;
    btn.title = otherLabel === '🌐 EN' ? '切换到 English' : 'Switch to 中文';
  };
  refreshLabel();
  btn.addEventListener('click', () => {
    const other = _current === 'zh-CN' ? 'en' : 'zh-CN';
    setLang(other);
    refreshLabel(); // 立即更新文字 (不用等 lc:langchange 事件)
  });
  // 同步外部切语言 (如别的模块触发 setLang) 也更新按钮
  window.addEventListener('lc:langchange', refreshLabel);
}
