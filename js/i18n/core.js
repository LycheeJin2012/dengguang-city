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
  'common.comments':   { 'zh-CN': '评论',         'en': 'Comments' },
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
  'license.signupPrompt':    { 'zh-CN': '请先登录玩家账号再报名考试', 'en': 'Log in to sign up for the exam' },
  'license.netError':       { 'zh-CN': '网络错误，请稍后再试',    'en': 'Network error, please try again later' },
  // 赛车规格
  'spec.price.tbd':          { 'zh-CN': '试车价格待公告',       'en': 'Trial price TBD' },
  'license.grade.B':        { 'zh-CN': 'B 级（初级）',         'en': 'B (Beginner)' },
  'license.grade.A':        { 'zh-CN': 'A 级（中级）',         'en': 'A (Intermediate)' },
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
  'common.cancel':       { 'zh-CN': '取消',            'en': 'Cancel' },
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
  // admin-v37 tab 标签
  'admin.tab.tickets':      { 'zh-CN': '工单中心',         'en': 'Tickets' },
  'admin.tab.players':      { 'zh-CN': '玩家管理',         'en': 'Players' },
  'admin.tab.kart':         { 'zh-CN': '赛道 / 国际试车',  'en': 'Kart / Circuit' },
  'admin.tab.announcements': { 'zh-CN': '公告管理',         'en': 'Announcements' },
  'admin.tab.gallery':      { 'zh-CN': '首页图集',         'en': 'Gallery' },
  'admin.tab.dms':          { 'zh-CN': '私信监管',         'en': 'DM Monitor' },
  'admin.tab.admins':       { 'zh-CN': '管理员账号',       'en': 'Admins' },
  'admin.tab.password':     { 'zh-CN': '修改我的密码',     'en': 'Change Password' },
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
  'hotel.intro':            { 'zh-CN': '树上酒店（筹建）。选址、规模、定价、运营方由市民大会与合作社讨论后公布。当前展示房型为草案，待合作社定稿后正式上线。',
                               'en': 'Treehouse Hotel (under construction). Site, scale, pricing, and operator will be decided by the Citizens Assembly and the cooperative. Room listings shown are drafts and will go live once finalized.' },
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
  'admin.circuit.license.all':  { 'zh-CN': '全部驾照',   'en': 'All Licenses' },
  'admin.kart.circuit':   { 'zh-CN': '国际试车',          'en': 'Circuit' },
  'admin.kart.manage':     { 'zh-CN': '赛车场管理 (SUPER)', 'en': 'Karting Mgmt (SUPER)' },
  'admin.dms.title':       { 'zh-CN': '私信监管',          'en': 'DM Monitor' },
  'admin.dms.hint':        { 'zh-CN': '监管所有玩家私信对话，可以灯灯客服身份代为回复，或查看 AI 客服"转人工"建议的对话。', 'en': 'Monitor all player DM conversations. Reply as DengDeng or review conversations flagged for human handoff.' },
  'admin.dms.empty':       { 'zh-CN': '暂无私信记录',      'en': 'No DM records' },
  'admin.gallery.title':   { 'zh-CN': '首页图集管理',      'en': 'Gallery Management' },
  'admin.gallery.hint':    { 'zh-CN': '管理首页"城市风貌"和"实景图集"栏目用的所有图片。修改后, 首页 index.html 会立即拉新版本。', 'en': 'Manage all images used in the "Scenery" and "Photo Gallery" sections on the homepage.' },
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
