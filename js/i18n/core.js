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
  // 主页 hero CTA
  'hero.cta.notice':  { 'zh-CN': '▶ 查看公告', 'en': '▶ View Notice' },
  'hero.cta.service': { 'zh-CN': '市民服务',   'en': 'Civic Service' },
  // 列表 3 态文案 (N5 Step 15: loading/empty/error 全 i18n)
  'common.error.load':    { 'zh-CN': '加载失败',         'en': 'Load failed' },
  'common.error.render':  { 'zh-CN': '渲染失败',         'en': 'Render failed' },
  'common.empty':         { 'zh-CN': '暂无数据',         'en': 'No data' },
  'hotel.empty.filtered': { 'zh-CN': '没有符合条件的房型，试试调整筛选条件。', 'en': 'No matching rooms. Try adjusting filters.' },
  'messages.empty':       { 'zh-CN': '暂无留言, 来抢沙发', 'en': 'No messages yet. Be the first!' },
  'messages.empty.comments': { 'zh-CN': '暂无评论, 来抢沙发', 'en': 'No comments yet. Be the first!' },
  'gallery.empty':        { 'zh-CN': '暂无图集',         'en': 'No gallery items' },
  'announcements.empty':  { 'zh-CN': '暂无公告',         'en': 'No announcements' },
  'exam.empty':           { 'zh-CN': '驾照考试暂未开放, 市政厅公告后启动。', 'en': 'License exam not open yet. Will start after city hall notice.' },
  'track.empty':          { 'zh-CN': '暂无开放赛道',     'en': 'No open tracks' },
  'track.price.loadFail': { 'zh-CN': '试车价格加载失败',  'en': 'Failed to load trial price' },
  // v50-N6 (C1): 玩家榜单
  'board.tab.messages':  { 'zh-CN': '💬 留言数榜',     'en': '💬 Most Active' },
  'board.tab.bookings':  { 'zh-CN': '🏨 酒店预订榜',   'en': '🏨 Top Travelers' },
  'board.tab.licenses':  { 'zh-CN': '🚗 驾照等级榜',   'en': '🚗 License Holders' },
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
