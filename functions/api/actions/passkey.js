// v45 重写: 通行密钥 (Passkey) action 群 (10 个)
// 从 init.js LEGACY 段 L168-247 拆出
import { ok, err, parseSession, resolveSubjectFromSession, resolveSubjectByUsername, getRpId, getOrigin } from '../_helpers.js';
import {
  passkeyRegisterStart, passkeyRegisterFinish, passkeyLoginStart, passkeyLoginFinish,
  listPasskeys, deletePasskey
} from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const { sess: _sess } = await parseSession(env, request);
  const rpId = getRpId(request);
  const origin = getOrigin(request);
  const expectedOrigin = { type: 'webauthn.create', origin };

  try {
    if (action === 'passkey-register-start') {
      if (!_sess) return err(401, '需要先登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在或已禁用');
      const r = await passkeyRegisterStart(env, _subject, rpId, expectedOrigin);
      return ok({ challenge_token: r.challengeToken, publicKey: r.publicKey });
    }
    if (action === 'passkey-register-finish') {
      if (!_sess) return err(401, '需要先登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在');
      const b = await request.json();
      const r = await passkeyRegisterFinish(env, _subject, rpId, expectedOrigin, b);
      return ok({ id: r.id, name: r.name });
    }
    if (action === 'passkey-login-start') {
      // 公开: 根据 username 找 subject
      const b = await request.json().catch(() => ({}));
      const _username = (b.username || '').trim();
      if (!_username) return err(400, 'username 必填');
      const _subj = await resolveSubjectByUsername(env, _username);
      if (!_subj) return err(404, '账号不存在或已禁用');
      const r = await passkeyLoginStart(env, _subj, rpId, expectedOrigin);
      return ok({ challenge_token: r.challengeToken, publicKey: r.publicKey });
    }
    if (action === 'passkey-login-finish') {
      const b = await request.json();
      const _ct = b.challenge_token;
      if (!_ct) return err(400, 'challenge_token 必填');
      const ch = await env.DB.prepare('SELECT * FROM webauthn_challenges WHERE challenge = ? AND purpose = ?')
        .bind(_ct, 'login').first();
      if (!ch || new Date(ch.expires_at) <= new Date()) return err(400, 'challenge 过期或无效');
      const _subj = ch.player_id
        ? { kind: 'player', id: ch.player_id, username: '' }
        : { kind: 'admin', id: ch.admin_id, username: '' };
      const _pk = await env.DB.prepare(
        "SELECT * FROM passkeys WHERE credential_id = ? AND (player_id = ? OR admin_id = ?)"
      ).bind(b.credential.id, _subj.id, _subj.id).first();
      if (!_pk) return err(401, '通行密钥不匹配');
      const r = await passkeyLoginFinish(env, _subj, _pk, rpId, expectedOrigin, b);
      if (r && r.token) {
        const cookie = `lc_session=${r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 3600}`;
        return new Response(JSON.stringify({ ok: true, user: r.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie }
        });
      }
      return ok({ ok: true });
    }
    if (action === 'passkey-list') {
      if (!_sess) return err(401, '需要登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在');
      const keys = await listPasskeys(env, _subject);
      return ok({ passkeys: keys });
    }
    if (action === 'passkey-delete') {
      if (!_sess) return err(401, '需要登录');
      const b = await request.json();
      const id = parseInt(b.id || 0, 10);
      if (!id) return err(400, 'id 必填');
      await deletePasskey(env, id);
      return ok({ id, deleted: true });
    }
    if (action === 'passkey-test-start' || action === 'passkey-test-finish') {
      // 测试现有 passkey (用于验证密钥有效性, 不登录)
      return err(501, 'passkey-test 暂未实现, 走 /api/admin/passkey-debug');
    }
    return err(404, '未知 passkey action');
  } catch (e) {
    return err(500, 'passkey 错误: ' + (e?.message || String(e)));
  }
}
