// v50: admin 后台 dashboard 聚合 (8 COUNT 并发)
import { ok, err, handleOptions, requireAdmin } from './_helpers.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const r = await requireAdmin(context);
  if (r.error) return r.error;

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
