// v45 重写: Session (cookie/token) 管理 + 账号合并
// 从 _shared.js L67-148 拆出
import { randomToken } from './auth.js';

const SESSION_TTL_HOURS = 8;

export async function createSession(env, playerId = null, adminId = null) {
  const token = randomToken(24);
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, player_id, admin_id, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, playerId, adminId, expires).run();
  return { token, expires_at: expires };
}

// v17.9 修订: 合并管理员和玩家账号 (双向 linked_player_id / linked_admin_id)
// 合并后:
//   - 玩家侧登录(玩家密码或玩家通行密钥)自动获得 combined session (含 admin 身份)
//   - 退出管理无需验证(只销毁 admin 身份, 保留 player session)
//   - 通行密钥在任一边注册, 登录时即可在两边使用
//   - 两边密码不共享: 改 admin 密码不影响 player, 改 player 密码不影响 admin
export async function mergeAccount(env, adminId, playerId) {
  if (!adminId || !playerId) throw new Error('mergeAccount: adminId 和 playerId 必填');
  const _p = await env.DB.prepare("SELECT id, username, status FROM players WHERE id = ? AND status = 'active'").bind(playerId).first();
  if (!_p) throw new Error('玩家不存在或未激活');
  const _a = await env.DB.prepare("SELECT id, username FROM admins WHERE id = ?").bind(adminId).first();
  if (!_a) throw new Error('管理员不存在');
  const _pOld = await env.DB.prepare('SELECT linked_admin_id FROM players WHERE id = ?').bind(playerId).first();
  if (_pOld?.linked_admin_id && _pOld.linked_admin_id !== adminId) {
    throw new Error(`玩家 ${_p.username} 已绑定其他管理员 (id=${_pOld.linked_admin_id}), 请先解绑`);
  }
  const _aOld = await env.DB.prepare('SELECT linked_player_id FROM admins WHERE id = ?').bind(adminId).first();
  if (_aOld?.linked_player_id && _aOld.linked_player_id !== playerId) {
    throw new Error(`管理员 ${_a.username} 已绑定其他玩家 (id=${_aOld.linked_player_id}), 请先解绑`);
  }
  await env.DB.prepare('UPDATE admins SET linked_player_id = ? WHERE id = ?').bind(playerId, adminId).run();
  await env.DB.prepare('UPDATE players SET linked_admin_id = ? WHERE id = ?').bind(adminId, playerId).run();
  return { admin_id: adminId, player_id: playerId, admin_username: _a.username, player_username: _p.username };
}

export async function unmergeAccount(env, adminId, playerId) {
  if (!adminId || !playerId) throw new Error('unmergeAccount: adminId 和 playerId 必填');
  await env.DB.prepare(
    'UPDATE admins SET linked_player_id = NULL WHERE id = ? AND linked_player_id = ?'
  ).bind(playerId, adminId).run();
  await env.DB.prepare(
    'UPDATE players SET linked_admin_id = NULL WHERE id = ? AND linked_admin_id = ?'
  ).bind(adminId, playerId).run();
}

export async function getSession(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT token, player_id, admin_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}

export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function readToken(request) {
  const h = request.headers.get('X-Session-Token') || request.headers.get('Authorization');
  if (h) {
    if (h.startsWith('Bearer ')) return h.slice(7);
    return h;
  }
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)lc_session=([^;]+)/);
  if (m) return m[1];
  return null;
}
