// v50: 每日签到 (玩家鉴权)
import { ok, err, getSession, readToken } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'signin';
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');

  if (action === 'signin') {
    const today = new Date().toISOString().slice(0, 10);
    const exist = await env.DB.prepare('SELECT id FROM daily_signin WHERE player_id = ? AND signin_date = ?').bind(sess.player_id, today).first();
    if (exist) return ok({ already: true, date: today });
    // 计算 streak
    const prev = await env.DB.prepare(
      "SELECT signin_date, streak FROM daily_signin WHERE player_id = ? AND signin_date < ? ORDER BY signin_date DESC LIMIT 1"
    ).bind(sess.player_id, today).first();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = (prev && prev.signin_date === yesterday) ? (prev.streak + 1) : 1;
    await env.DB.prepare('INSERT INTO daily_signin (player_id, signin_date, streak) VALUES (?, ?, ?)').bind(sess.player_id, today, streak).run();
    // 奖励绿宝石
    await env.DB.prepare('UPDATE players SET emeralds = emeralds + 1 WHERE id = ?').bind(sess.player_id).run();
    return ok({ date: today, streak, reward: 1 });
  }

  return err(400, '未知 action');
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const today = new Date().toISOString().slice(0, 10);
  const done = await env.DB.prepare('SELECT id, streak FROM daily_signin WHERE player_id = ? AND signin_date = ?').bind(sess.player_id, today).first();
  const last = await env.DB.prepare('SELECT signin_date, streak FROM daily_signin WHERE player_id = ? ORDER BY signin_date DESC LIMIT 1').bind(sess.player_id).first();
  return ok({ done: !!done, today, last_streak: last?.streak || 0 });
}
