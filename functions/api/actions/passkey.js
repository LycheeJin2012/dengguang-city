// v50: Passkey (WebAuthn) action 群
import { ok, err, parseSession, resolveSubjectFromSession, resolveSubjectByUsername, getRpId, getOrigin } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const { sess: _sess } = await parseSession(env, request);
  const rpId = getRpId(request);
  const origin = getOrigin(request);
  const expectedOriginReg  = { type: 'webauthn.create', origin };
  const expectedOriginLogin = { type: 'webauthn.get',    origin };

  // passkey helpers
  const {
    passkeyRegisterStart, passkeyRegisterFinish, passkeyLoginStart, passkeyLoginFinish,
    listPasskeys, deletePasskey,
  } = await import('../../_shared.js');

  try {
    if (action === 'passkey-register-start') {
      if (!_sess) return err(401, '需要先登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在');
      const r = await passkeyRegisterStart(env, _subject, rpId);
      return ok({ challenge_token: r.challenge_token, publicKey: r.publicKey });
    }
    if (action === 'passkey-register-finish') {
      if (!_sess) return err(401, '需要先登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在');
      const b = await request.json();
      const r = await passkeyRegisterFinish(env, b, _subject, rpId, expectedOriginReg);
      return ok({ id: r.id, name: r.name });
    }
    if (action === 'passkey-login-start') {
      const b = await request.json().catch(() => ({}));
      const _username = (b.username || '').trim();
      if (_username) {
        const _subj = await resolveSubjectByUsername(env, _username);
        if (!_subj) return err(404, '账号不存在');
      }
      const r = await passkeyLoginStart(env, _username, rpId);
      return ok({ challenge_token: r.challenge_token, publicKey: r.publicKey });
    }
    if (action === 'passkey-login-finish') {
      const b = await request.json();
      const _target = (b.target === 'admin' || b.target === 'player') ? b.target : undefined;
      const r = await passkeyLoginFinish(env, b, rpId, expectedOriginLogin, _target);
      if (r && r.token) {
        const { cookieFor } = await import('../../_shared.js');
        const cookie = cookieFor(r.token);
        const _user = r.kind === 'admin' ? r.admin : r.player;
        return new Response(JSON.stringify({ ok: true, user: _user, kind: r.kind }), {
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
    return err(404, '未知 passkey action');
  } catch (e) {
    return err(500, 'passkey 错误: ' + (e?.message || String(e)));
  }
}
