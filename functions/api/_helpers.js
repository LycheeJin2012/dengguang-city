// v50: API 共享 helpers
// 兼容老 api/actions/*.js 导入路径 (它们 import { ... } from '../_helpers.js')

export {
  ok, err, json, handleOptions,
  bytesToHex, hexToBytes, bytesToB64url, b64urlToBytes,
  randomToken, hashPassword, verifyPassword,
  readToken, cookieFor, createSession, getSession, destroySession,
  mergeAccount, unmergeAccount,
  rateLimit, isNonEmpty, isEmail, isUsername, stripHtml,
  createTicket, ticketFromMessage, ticketFromBooking,
  ticketFromLicense, ticketFromCircuit, ticketFromKart,
} from '../_shared.js';

// RP ID / Origin (WebAuthn 用)
export function getRpId(request) {
  const u = new URL(request.url);
  return u.hostname;
}
export function getOrigin(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

// resolveSubject (用于 passkey)
export async function resolveSubjectFromSession(env, sess) {
  if (sess?.player_id) {
    return await env.DB.prepare(
      'SELECT id, username, email, status, "player" AS kind FROM players WHERE id = ?'
    ).bind(sess.player_id).first();
  }
  if (sess?.admin_id) {
    return await env.DB.prepare(
      'SELECT id, username, role, "admin" AS kind FROM admins WHERE id = ?'
    ).bind(sess.admin_id).first();
  }
  return null;
}
export async function resolveSubjectByUsername(env, username) {
  const p = await env.DB.prepare('SELECT id, username, email, status, "player" AS kind FROM players WHERE username = ?').bind(username).first();
  if (p) return p;
  return await env.DB.prepare('SELECT id, username, role, "admin" AS kind FROM admins WHERE username = ?').bind(username).first();
}

export async function parseSession(env, request) {
  const { readToken, getSession } = await import('../_shared.js');
  const token = readToken(request);
  const sess = await getSession(env, token);
  return { sess, token };
}
