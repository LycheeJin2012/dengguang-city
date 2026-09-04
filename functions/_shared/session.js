// v50: Session 管理 (D1 sessions 表)
import { randomToken, hashPassword } from './auth.js';
import { handleOptions } from './http.js';

const COOKIE_NAME = 'lc_session';
const SESSION_TTL = 8 * 3600; // 8h

export function readToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(/;\s*/)) {
    const [k, v] = part.split('=');
    if (k === COOKIE_NAME) return v;
  }
  // 也支持 Authorization: Bearer <token>
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export function cookieFor(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export async function createSession(env, { player_id = null, admin_id = null, ip = null, ua = null, combined = false }) {
  const token = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO sessions (token, player_id, admin_id, combined, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${SESSION_TTL} seconds'))`
  ).bind(token, player_id, admin_id, combined ? 1 : 0, ip, ua).run();
  return token;
}

export async function getSession(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.*, p.username AS player_username, p.status AS player_status, a.username AS admin_username, a.role AS admin_role
     FROM sessions s
     LEFT JOIN players p ON p.id = s.player_id
     LEFT JOIN admins a ON a.id = s.admin_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  if (!row) return null;
  return {
    token: row.token,
    player_id: row.player_id,
    admin_id: row.admin_id,
    combined: !!row.combined,
    player: row.player_id ? { id: row.player_id, username: row.player_username, status: row.player_status } : null,
    admin: row.admin_id ? { id: row.admin_id, username: row.admin_username, role: row.admin_role } : null,
  };
}

export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// 合并账号: admin + player (用同一 token)
export async function mergeAccount(env, { player_id, admin_id }) {
  const token = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO sessions (token, player_id, admin_id, combined, expires_at)
     VALUES (?, ?, ?, 1, datetime('now', '+${SESSION_TTL} seconds'))`
  ).bind(token, player_id, admin_id).run();
  return token;
}

export async function unmergeAccount(env, token) {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}
