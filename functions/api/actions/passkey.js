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
      // v45 修: passkeyRegisterStart 签名 (env, subject, rpId), 不要传 expectedOrigin
      const r = await passkeyRegisterStart(env, _subject, rpId);
      return ok({ challenge_token: r.challenge_token, publicKey: r.publicKey });
    }
    if (action === 'passkey-register-finish') {
      if (!_sess) return err(401, '需要先登录');
      const _subject = await resolveSubjectFromSession(env, _sess);
      if (!_subject) return err(401, '账号不存在');
      const b = await request.json();
      // v45 修: passkeyRegisterFinish 签名 (env, body, subject, rpId, expectedOrigin)
      //        老 init.js 错传 (env, subject, rpId, expectedOrigin, b) 顺序乱
      const r = await passkeyRegisterFinish(env, b, _subject, rpId, expectedOrigin);
      return ok({ id: r.id, name: r.name });
    }
    if (action === 'passkey-login-start') {
      // 公开: 根据 username 找 subject
      // v45 修: passkeyLoginStart 签名是 (env, username, rpId), username 是 string
      //        老 init.js 错传 (env, subject, rpId, expectedOrigin) 导致 D1_TYPE_ERROR
      const b = await request.json().catch(() => ({}));
      const _username = (b.username || '').trim();
      if (!_username) return err(400, 'username 必填');
      // 提前检查 subject 是否存在 (404 比 200 + 空 allowCredentials 更友好)
      const _subj = await resolveSubjectByUsername(env, _username);
      if (!_subj) return err(404, '账号不存在或已禁用');
      const r = await passkeyLoginStart(env, _username, rpId);
      return ok({ challenge_token: r.challenge_token, publicKey: r.publicKey });
    }
    if (action === 'passkey-login-finish') {
      // v45 修: passkeyLoginFinish 实际签名 (env, body, rpId, expectedOrigin), 4 参数
      //        函数内部自己查 passkey, 不接受 _subj / _pk 参数
      //        老 init.js 传 6 参数是错的, 但 shared.js 多余参数会被忽略, 所以老代码"看起来" 工作
      //        (但 _subj.id / _pk 检查跟 shared.js 内部查的重复)
      const b = await request.json();
      const r = await passkeyLoginFinish(env, b, rpId, expectedOrigin);
      if (r && r.token) {
        // r.kind = 'player' | 'admin', r.{player|admin} 都有
        const cookie = `lc_session=${r.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 3600}`;
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
    if (action === 'passkey-test-start' || action === 'passkey-test-finish') {
      // 测试现有 passkey (用于验证密钥有效性, 不登录)
      return err(501, 'passkey-test 暂未实现, 走 /api/admin/passkey-debug');
    }
    return err(404, '未知 passkey action');
  } catch (e) {
    return err(500, 'passkey 错误: ' + (e?.message || String(e)));
  }
}
