// v47: 订阅 API (玩家订阅公告/留言回复/私信)
// GET  /api/subscriptions?my=1            - 我的订阅
// POST /api/subscriptions   body: {type, target_id?, channel?}  - 新增/启用
// DELETE /api/subscriptions?id=X          - 取消订阅
// v47 阶段只做 channel=site (站内), email/Telegram 后续接

import { ok, err, readToken, getSession } from '../_shared.js';

const TYPES = new Set(['announcement', 'reply', 'dm']);
const CHANNELS = new Set(['site', 'email', 'telegram']);

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  if (url.searchParams.get('my') !== '1') return err(400, '仅支持 my=1');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');
  const rows = await env.DB.prepare(
    `SELECT id, type, target_id, channel, enabled, created_at FROM subscriptions
     WHERE player_id = ? ORDER BY created_at DESC`
  ).bind(sess.player_id).all();
  return ok({ subscriptions: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');
  const body = await request.json().catch(() => ({}));
  const type = (body.type || '').toString();
  const targetId = body.target_id ? parseInt(body.target_id, 10) : null;
  const channel = (body.channel || 'site').toString();
  if (!TYPES.has(type)) return err(400, 'type 必填 announcement/reply/dm');
  if (!CHANNELS.has(channel)) return err(400, 'channel 必填 site/email/telegram');
  if (channel !== 'site') return err(501, `${channel} 通道尚未实现, 请先用 site`);

  // 同 type + target_id + channel 视为同一订阅, 启用而非新建
  const existing = await env.DB.prepare(
    `SELECT id FROM subscriptions
     WHERE player_id = ? AND type = ? AND (target_id = ? OR (target_id IS NULL AND ? IS NULL)) AND channel = ?`
  ).bind(sess.player_id, type, targetId, targetId, channel).first();
  if (existing) {
    await env.DB.prepare('UPDATE subscriptions SET enabled = 1 WHERE id = ?').bind(existing.id).run();
    return ok({ id: existing.id, updated: true });
  }
  const r = await env.DB.prepare(
    `INSERT INTO subscriptions (player_id, type, target_id, channel) VALUES (?, ?, ?, ?)`
  ).bind(sess.player_id, type, targetId, channel).run();
  return ok({ id: r.meta?.last_row_id, created: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  // 软删: 设为 enabled=0, 保留记录方便后续恢复
  await env.DB.prepare('UPDATE subscriptions SET enabled = 0 WHERE id = ? AND player_id = ?')
    .bind(id, sess.player_id).run();
  return ok({ id, disabled: true });
}
