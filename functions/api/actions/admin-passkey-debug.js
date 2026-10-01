// v45 重写: 管理员 passkey debug 端点群 (3 个, super only)
// 从 init.js LEGACY 段 L394-432 拆出
// 包含 admin-passkey-debug / admin-passkey-fix-jwks / admin-passkey-reregister
//
// 2026-10-01：本文件在 v45 拆出后**一直没接回 init.js 的分发表** ——
// init.js 用 `action.startsWith('passkey-')` 匹配，而这三个 action 是
// `admin-passkey-` 开头，匹配不上，于是走 /api/init 一律 404「未知功能」。
// 实跑确认：直连 /api/actions/admin-passkey-debug 返回 200，走 init 返回 404。
// 已在 init.js 里补上 `admin-passkey-` 前缀分支。
import { ok, err, parseSession } from '../_helpers.js';
// integer() 是严格整数校验，在 _core/request.js 里（_helpers.js 不导出它）。
// HttpError 同样要引：下面那个 catch 默认把一切异常兜成 500，
// 但参数校验失败得如实回 4xx，得靠 instanceof 把它挑出来。
import { integer, HttpError } from '../../_core/request.js';

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
    // 参数校验类错误（integer() 抛的 HttpError）不是「debug 错误」，不能兜成 500。
    // 它是客户端把 player_id 传错了，该如实回 4xx，别让运维背锅去查 SQL。
    if (e instanceof HttpError) return err(e.status, e.message);
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
 * 2026-10-01 修：player_id 原来走的是 parseInt，所以 '1abc'、'1.9' 都会被
 * `parseInt` 吃成 1，然后**真的**执行 `DELETE FROM passkeys WHERE player_id=1`
 * —— 一次手滑就能删掉别人全部的通行密钥。改用 `integer()` 做严格整数校验
 * （min=1，顺带挡住 0 和负数），与 `functions/_core/request.js` 里既有的用法一致。
 *
 * 这条修复与「接回 init.js 分发表」同批：接回之前必须先堵住这个误删面。
 */
async function reregisterPasskeys(env, request) {
  const body = await request.json().catch(() => ({}));
  // 先挡类型再校验数值：`integer()` 内部是 `Number(value)`，而
  // Number(true) === 1、Number(null) === 0 —— 也就是说光靠 integer()，
  // 传 `{"player_id": true}` 会被当成玩家 1 然后**真的删掉他的全部密钥**。
  // 原来的 parseInt 对 true 返回 NaN 才躲过了这一劫。这里显式只收
  // number 与数字字符串。
  const raw = body.player_id;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return err(400, 'player_id 必须是数字');
  }
  const playerId = integer(raw, 'player_id');
  const result = await env.DB.prepare('DELETE FROM passkeys WHERE player_id = ?').bind(playerId).run();
  return ok({
    player_id: playerId,
    deleted: result.meta.changes || 0,
    message: '已删该玩家全部 passkey, 让用户重新注册',
  });
}
