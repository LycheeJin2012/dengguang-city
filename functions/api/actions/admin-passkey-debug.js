// v50: Passkey debug (admin only)
import { ok, err, getSession, readToken } from '../_helpers.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.admin_id) return err(401, '需要管理员');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';
  if (action === 'list') {
    const rows = await env.DB.prepare(
      `SELECT id, player_id, admin_id, name, credential_id, counter, created_at, last_used_at
       FROM passkeys ORDER BY id DESC LIMIT 200`
    ).all();
    return ok({ passkeys: rows.results || [] });
  }
  if (action === 'challenges') {
    const rows = await env.DB.prepare(
      `SELECT token, kind, subject, expires_at, created_at FROM webauthn_challenges ORDER BY created_at DESC LIMIT 50`
    ).all();
    return ok({ challenges: rows.results || [] });
  }
  return err(400, '未知 action');
}
