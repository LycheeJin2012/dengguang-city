// v45 重写: 管理员 passkey debug 端点群 (3 个, super only)
// 从 init.js LEGACY 段 L394-432 拆出
// 包含 admin-passkey-debug / admin-passkey-fix-jwks / admin-passkey-reregister
//
// v88.7 去压缩重写: 只改排版与结构, 行为一个字都没动。
// 下面三处「看起来不严谨但保留原样」的地方都加了说明, **不要顺手修** ——
// 修它们要单独决策, 证据见 tests/admin-actions-equiv.test.js。
import { ok, err, parseSession } from '../_helpers.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 两级鉴权: 先要管理员会话(401), 再要 super 角色(403)。
  // 顺序不能倒 —— 先查数据再鉴权等于把未授权数据读出来才判断能不能给。
  const { sess: _sess, me: _me } = await parseSession(env, request);
  if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
  if (!_me || _me.role !== 'super') return err(403, '只有 super 管理员可用');

  // 三个 action 共用这一个 try: 任何一条 SQL 报错都变成 500,
  // 错误文案原样抖回客户端(运维端点, 有意为之)。
  //
  // v88.7 踩过的坑: 这里必须写 `return await fn(...)` 而不是 `return fn(...)`。
  // 裸 return 会先把 promise 交出去、栈帧退出 try, 之后才 reject 的异常就**绕过**
  // 这个 catch 了(实测: 三个分支的 500 全部变成裸抛)。
  try {
    if (action === 'admin-passkey-debug') return await listPasskeys(env);
    if (action === 'admin-passkey-fix-jwks') return await reportJwks(env);
    if (action === 'admin-passkey-reregister') return await reregisterPasskeys(env, request);
    return err(404, '未知 admin-passkey-debug action');
  } catch (e) {
    return err(500, 'debug 错误: ' + (e?.message || String(e)));
  }
}

// 列所有 passkey 详情
async function listPasskeys(env) {
  const rows = await env.DB.prepare(
    "SELECT id, player_id, admin_id, name, credential_id, public_key_jwk, created_at, last_used_at FROM passkeys ORDER BY id DESC"
  ).all();
  return ok({ passkeys: rows.results || [] });
}

/**
 * 批量修 JWK 格式 (历史 bug: COSE_Key 偏移错位)
 *
 * 名字叫 fix, 但其实只统计不写库 —— 返回扫描总数与合法数。
 * 单条解析失败(脏 JSON, 或解析出 null/数字这种取不到 .crv 的值)直接跳过,
 * 计数用 per-row 的 try 包着, 一条坏数据不会让整个扫描失败。
 */
async function reportJwks(env) {
  const rows = await env.DB.prepare('SELECT id, public_key_jwk FROM passkeys').all();
  const all = rows.results || [];
  let valid = 0;
  for (const r of all) {
    try {
      const jwk = JSON.parse(r.public_key_jwk);
      if (jwk.crv === 'P-256' && jwk.x && jwk.y) {
        valid++;
      }
    } catch (e) { /* skip invalid */ }
  }
  return ok({ total: all.length, valid: valid, message: '已扫描所有 passkey JWK, 报告合法数' });
}

/**
 * 强制重置某玩家的 passkey (超级管理员用, 删了重让用户注册)
 *
 * v88.7 保留(v88.7 未改): player_id 走的是 parseInt 而不是严格整数校验,
 * 所以 '1abc'、1.9 都会被吃成 1 并**真的**删掉 1 号玩家的全部 passkey;
 * 负数(-5)也不拦, 只是恰好匹配不到行。修它要单独提工单, 本轮只做可读性重写。
 */
async function reregisterPasskeys(env, request) {
  const body = await request.json().catch(() => ({}));
  const playerId = parseInt(body.player_id || 0, 10);
  if (!playerId) return err(400, 'player_id 必填');
  const result = await env.DB.prepare('DELETE FROM passkeys WHERE player_id = ?').bind(playerId).run();
  return ok({
    player_id: playerId,
    deleted: result.meta.changes || 0,
    message: '已删该玩家全部 passkey, 让用户重新注册',
  });
}
