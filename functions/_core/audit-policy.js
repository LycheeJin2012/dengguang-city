/** 登录/鉴权动作不写审计表：审计本身要查会话，写进去既递归又没追溯价值 */
const authentication = new Set([
  'passkey-login-start',
  'passkey-login-finish',
  'admin-enter-password',
  'admin-logout',
  'passkey-admin-start',
  'passkey-admin-finish',
  'passkey-test-start',
]);

/** 纯读取动作不入审计表：量大、且事后无人回看 */
const reads = new Set([
  'dm-read',
  'passkey-list',
  'signin-status',
  'admin-dm-conversations',
  'admin-dm-thread',
  'admin-dm-list',
  'admin-dm-ai-struggle',
  'admin-player-list',
  'admin-passkey-debug',
  'admin-dm-ai-suggest',
]);

/**
 * 这次请求要不要记审计。
 *
 * 判据是「有没有产生或即将产生状态变化」，不是「是不是写方法」——
 * 导出、下载这类带副作用的 GET 同样要记。
 */
export function shouldAudit(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (url.pathname === '/api/login' || authentication.has(action)) return false;
  if (reads.has(action)) return false;

  // 下面这条靠 HTTP 方法区分读写，路径和 action 都盖不住，只能看方法
  // （原来这里还有一条 legacy 留言管理路由的 POST 豁免，那条路由已删除）
  if (url.pathname === '/api/uploads' && request.method === 'PUT') return false;

  return (
    url.searchParams.get('export') === '1' ||
    url.searchParams.get('save') === '1' ||
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  );
}

/** 路径 → 审计表名。查不到的一律记成 'request'：宁可粗一点，也不要漏记 */
const resources = {
  '/api/city-map': 'city_places',
  '/api/account-security': 'sessions',
  '/api/ticket-updates': 'tickets',
  '/api/reply-feedback': 'reply_feedback',
  '/api/exam-appeals': 'exam_appeals',
  '/api/exam-sessions': 'exam_sessions',
  '/api/admin/exam-review': 'exam_sessions',
  '/api/admin/knowledge': 'knowledge_articles',
  '/api/admin/exam-ai': 'exam_question_drafts',
  '/api/social': 'direct_messages',
  '/api/support': 'support_chats',
  '/api/admin/support-chat': 'support_chats',
  '/api/admin/ai-draft': 'tickets',
  '/api/admin/dispatch-settings': 'dispatch_settings',
  '/api/admin/auto-dispatch': 'tickets',
  '/api/tickets': 'tickets',
  '/api/ticket-comments': 'ticket_comments',
  '/api/messages': 'messages',
  '/api/comments': 'message_comments',
  '/api/admin/hotels': 'hotels',
  '/api/admin/hotel-rooms': 'hotel_rooms',
  '/api/admin/race-tracks': 'race_tracks',
  '/api/admin/players': 'players',
  '/api/admin/admins': 'admins',
  '/api/admin/hotel-owners': 'hotel_owners',
  '/api/admin/announcements': 'announcements',
  '/api/admin/gallery': 'gallery_items',
  '/api/uploads': 'media_uploads',
  '/api/register': 'players',
  '/api/bookings': 'bookings',
  '/api/admin/bookings': 'bookings',
  '/api/admin/license': 'license_signups',
  '/api/admin/kart': 'kart_signups',
  '/api/admin/circuit': 'circuit_signups',
};

/**
 * 一条请求对应的审计表名，写进 audit_events.resource_type。
 * 返回值只用于展示与筛选，后台不依赖它做权限判断。
 */
export function auditResource(url) {
  // 酒店经营接口按 entity 参数落在三张不同的表上
  if (url.pathname === '/api/hotel-owner') {
    const byEntity = { hotels: 'hotels', rooms: 'hotel_rooms', bookings: 'bookings' };
    return byEntity[url.searchParams.get('entity')] || 'hotel_owners';
  }

  // /api/init 是多动作合集接口，只能按 action 判断归属
  if (url.pathname === '/api/init') {
    const action = url.searchParams.get('action') || '';
    if (
      action === 'admin-player-create' ||
      action === 'admin-reset-player-password' ||
      action === 'player-change-password'
    ) {
      return 'players';
    }
    if (action.includes('merge-account')) return 'admins';
    if (action.startsWith('passkey-register')) return 'passkeys';
    // 三条都没命中：继续往下走 map，'/api/init' 不在 map 里，结果是 'request'
  }

  return resources[url.pathname] || 'request';
}
