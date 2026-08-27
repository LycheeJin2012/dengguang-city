// GET /api/admin/dashboard — 后台 1 次拉所有 tab 状态数据
// 替换: 之前 admin 启动时需要 9 个串行 render() 各自 fetch
// 优化: 8 个 COUNT 查询 Promise.all 并发, 1 个 GET 出全部 badge 数字
import { ok, err, readToken, getSession } from '../../_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(401, '需要管理员登录');

  // 8 个独立 COUNT 并发, 一次性拿到所有 tab 徽章
  const [
    msgUnread, msgTotal,
    playerPending, playerActive, playerRejected,
    bookPending, bookConfirmed, bookCompleted,
    licensePending, licensePassed, licenseFailed,
    kartPending, kartApproved, kartRejected,
    circuitPending, circuitApproved, circuitRejected,
    announcementsTotal, galleryTotal, adminsTotal,
  ] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM messages WHERE status = 'unread'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM messages").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE status = 'active'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM players WHERE status = 'rejected'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status = 'completed'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM license_signups WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM license_signups WHERE status = 'passed'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM license_signups WHERE status = 'failed'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM kart_signups WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM kart_signups WHERE status = 'approved'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM kart_signups WHERE status = 'rejected'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM circuit_signups WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM circuit_signups WHERE status = 'approved'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM circuit_signups WHERE status = 'rejected'").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM announcements").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM gallery_items").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM admins").first(),
  ]);

  const c = (r) => r?.c || 0;
  return ok({
    messages:   { unread: c(msgUnread), total: c(msgTotal) },
    players:    { pending: c(playerPending), active: c(playerActive), rejected: c(playerRejected) },
    bookings:   { pending: c(bookPending), confirmed: c(bookConfirmed), completed: c(bookCompleted) },
    license:    { pending: c(licensePending), passed: c(licensePassed), failed: c(licenseFailed) },
    kart:       { pending: c(kartPending), approved: c(kartApproved), rejected: c(kartRejected) },
    circuit:    { pending: c(circuitPending), approved: c(circuitApproved), rejected: c(circuitRejected) },
    announcements: c(announcementsTotal),
    gallery:       c(galleryTotal),
    admins:         c(adminsTotal),
  }, { headers: { 'Cache-Control': 'private, max-age=10' } });
}
