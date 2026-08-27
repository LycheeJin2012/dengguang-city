// POST /api/circuit  - 国际赛车场试车报名（需登录玩家）
// GET  /api/circuit  - 当前玩家所有国际赛车场试车 (profile 页用)
// v42: 保存 track_id / session / car / license / emeralds_charged (之前只存 name/contact/note, 用户选项全丢)
import { ok, err, stripHtml, readToken, getSession } from '../_shared.js';

// v42: 启动时只跑 circuit_signups 需要的迁移 (其他表的迁移交给 POST /api/init)
const CIRCUIT_MIGRATIONS = [
  `ALTER TABLE circuit_signups ADD COLUMN track_id INTEGER`,
  `ALTER TABLE circuit_signups ADD COLUMN session TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN car TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN license TEXT`,
  `ALTER TABLE circuit_signups ADD COLUMN emeralds_charged INTEGER NOT NULL DEFAULT 0`,
];
async function ensureMigrations(env) {
  if (globalThis.__lc_circuit_migrated) return;
  globalThis.__lc_circuit_migrated = true;
  for (const sql of CIRCUIT_MIGRATIONS) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* ALTER 重复会报错, 吞掉 */ }
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  await ensureMigrations(env);
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录玩家账号');
  const rows = await env.DB.prepare(
    'SELECT id, track_id, session, car, license, name, contact, note, emeralds_charged, status, created_at FROM circuit_signups WHERE player_id = ? ORDER BY created_at DESC LIMIT 30'
  ).bind(sess.player_id).all();
  return ok({ signups: rows.results });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  await ensureMigrations(env);
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess) return err(401, '请先登录玩家账号');

  let body;
  try { body = await request.json(); } catch (e) { return err(400, 'Invalid JSON'); }

  const name = stripHtml(body.name || '').trim();
  const contact = stripHtml(body.contact || '').trim();
  const note = stripHtml(body.note || '').trim();
  if (!name || !contact) return err(400, '姓名/联系方式必填');

  // v42: 读取前端提交的所有字段
  const trackId = parseInt(body.track_id || 0, 10) || null;
  const session = stripHtml(body.session || '').trim() || null;
  const car = stripHtml(body.car || '').trim() || null;
  const license = stripHtml(body.license || '').trim() || null;

  // 查 track 拿 trial_price (要扣玩家绿宝石)
  let emeraldsCharged = 0;
  if (trackId) {
    const tr = await env.DB.prepare('SELECT trial_price, name FROM race_tracks WHERE id = ? AND is_active = 1').bind(trackId).first();
    if (tr) emeraldsCharged = tr.trial_price || 0;
  }

  // 检查余额 (不够就拒绝)
  if (emeraldsCharged > 0) {
    const pl = await env.DB.prepare('SELECT emeralds FROM players WHERE id = ?').bind(sess.player_id).first();
    if (!pl || (pl.emeralds || 0) < emeraldsCharged) {
      return err(402, '💎 绿宝石余额不足 (需要 ' + emeraldsCharged + ' 💎, 当前 ' + (pl?.emeralds || 0) + ' 💎)');
    }
  }

  // 插报名记录 + 扣绿宝石 (单事务: 用 batch 顺序执行, D1 不支持事务但失败可回滚)
  const ins = await env.DB.prepare(
    'INSERT INTO circuit_signups (player_id, track_id, session, car, license, name, contact, note, emeralds_charged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(sess.player_id, trackId, session, car, license, name, contact, note || null, emeraldsCharged).run();

  // 扣绿宝石
  if (emeraldsCharged > 0) {
    await env.DB.prepare('UPDATE players SET emeralds = emeralds - ? WHERE id = ?')
      .bind(emeraldsCharged, sess.player_id).run();
  }

  return ok({ id: ins.meta.last_row_id, emeralds_charged: emeraldsCharged });
}
