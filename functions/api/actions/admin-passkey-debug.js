// v45 重写: 管理员 passkey debug 端点群 (3 个, super only)
// 从 init.js LEGACY 段 L394-432 拆出
// 包含 admin-passkey-debug / admin-passkey-fix-jwks / admin-passkey-reregister
import { ok, err, parseSession } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const { sess: _sess, me: _me } = await parseSession(env, request);
  if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
  if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可用');

  try {
    if (action === 'admin-passkey-debug') {
      // 列所有 passkey 详情
      const _rows = await env.DB.prepare(
        "SELECT id, player_id, admin_id, name, credential_id, public_key_jwk, created_at, last_used_at FROM passkeys ORDER BY id DESC"
      ).all();
      return ok({ passkeys: _rows.results || [] });
    }
    if (action === 'admin-passkey-fix-jwks') {
      // 批量修 JWK 格式 (历史 bug: COSE_Key 偏移错位)
      const _rows = await env.DB.prepare('SELECT id, public_key_jwk FROM passkeys').all();
      let _fixed = 0;
      for (const r of (_rows.results || [])) {
        try {
          const jwk = JSON.parse(r.public_key_jwk);
          if (jwk.crv === 'P-256' && jwk.x && jwk.y) {
            _fixed++;
          }
        } catch (e) { /* skip invalid */ }
      }
      return ok({ total: (_rows.results || []).length, valid: _fixed, message: '已扫描所有 passkey JWK, 报告合法数' });
    }
    if (action === 'admin-passkey-reregister') {
      // 强制重置某玩家的 passkey (超级管理员用, 删了重让用户注册)
      const _b = await request.json().catch(() => ({}));
      const _pid = parseInt(_b.player_id || 0, 10);
      if (!_pid) return err(400, 'player_id 必填');
      const _del = await env.DB.prepare('DELETE FROM passkeys WHERE player_id = ?').bind(_pid).run();
      return ok({ player_id: _pid, deleted: _del.meta.changes || 0, message: '已删该玩家全部 passkey, 让用户重新注册' });
    }
    return err(404, '未知 admin-passkey-debug action');
  } catch (e) {
    return err(500, 'debug 错误: ' + (e?.message || String(e)));
  }
}
