import { readToken, getSession } from '../_shared/session.js';

/** 带 HTTP 状态码的业务错误。endpoint() 认这个字段并原样回给前端。 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 抛出一个带状态码的错误 —— 这是本项目唯一的「失败」表达方式 */
export function fail(status, message) {
  throw new HttpError(status, message);
}

/**
 * 校验整数。
 *
 * 不用 parseInt：它对 '12abc' 返回 12，会让脏数据悄悄变成合法 id。
 * Number() + isSafeInteger 才是严格的。
 */
export function integer(value, name = 'id', min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    fail(400, `${name} 必须是 ${min}–${max} 范围内的整数`);
  }
  return n;
}

/**
 * 校验字符串：类型对、去空白后非空、不超长。
 *
 * 默认 required=true。选填的字段传 {required:false} —— 此时 null/undefined
 * 归一成空串，让下游 SQL 不用到处判空。
 */
export function string(value, name, max = 2000, { required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    fail(400, `${name} 必须是文字`);
  }
  const s = value.trim();
  if ((required && !s) || s.length > max) {
    fail(400, `${name} 需填写且不超过 ${max} 字符`);
  }
  return s;
}

/**
 * 解析请求体。
 *
 * 三道关：体积上限（2MB，防大 body 打爆内存）、JSON 可解析、必须是对象。
 * 最后一条尤其重要 —— 数组和 null 都得挡掉，否则下游 obj.foo 会静默拿到 undefined。
 */
export async function body(request) {
  const raw = await request.text();
  if (raw.length > 2 * 1024 * 1024) fail(413, '请求内容过大');

  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    fail(400, '请求不是有效 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(400, '请求必须是 JSON 对象');
  }
  return data;
}

/**
 * 取当前身份。
 *
 * **所有路由都必须先调它，再碰数据** —— 这是项目硬约束。
 * 顺序不能倒过来：先查数据再鉴权，等于把未授权数据读出来才判断能不能给。
 *
 * @param role 'player'（默认）/ 'admin' / 'super' / 'hotel_owner'
 */
export async function identity(context, role = 'player') {
  const { env, request } = context;

  if (!env.DB) fail(503, '数据库尚未连接');

  const s = await getSession(env, readToken(request));
  if (!s) fail(401, '请先登录');

  // 酒店老板：会话里直接带 hotel_owner_id，或由绑定的玩家身份反查
  if (role === 'hotel_owner') {
    const owner = s.hotel_owner_id
      ? await env.DB
          .prepare("SELECT id,username,linked_player_id FROM hotel_owners WHERE id=? AND status='active'")
          .bind(s.hotel_owner_id)
          .first()
      : s.player_id
        ? await env.DB
            .prepare(
              "SELECT o.id,o.username,o.linked_player_id FROM hotel_owners o JOIN players p ON p.id=o.linked_player_id WHERE o.linked_player_id=? AND o.status='active' AND p.status='active'"
            )
            .bind(s.player_id)
            .first()
        : null;
    if (!owner) fail(403, '没有酒店经营权限');
    return owner;
  }

  if (role === 'player') {
    if (!s.player_id) fail(401, '需要市民账号');
    // 每次都查库而不是信会话里的快照：账号可能刚被停用
    const p = await env.DB
      .prepare("SELECT id,username,email,status,emeralds FROM players WHERE id=? AND status='active'")
      .bind(s.player_id)
      .first();
    if (!p) fail(401, '账号未激活或已停用');
    return p;
  }

  // 剩下 admin / super
  if (!s.admin_id) fail(403, '需要管理员权限');
  const a = await env.DB
    .prepare('SELECT id,username,role,linked_player_id FROM admins WHERE id=?')
    .bind(s.admin_id)
    .first();
  if (!a) fail(401, '管理员账号已失效');
  if (role === 'super' && a.role !== 'super') fail(403, '此操作仅限 SUPER 管理员');
  return a;
}

/**
 * 统一响应壳。
 *
 * 三个头都不能少：no-store 防止私有数据进缓存，nosniff 防止 MIME 嗅探。
 */
export function reply(data = {}, status = 200) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const jsonError = (status, error) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/**
 * 所有路由的统一包装。
 *
 * 职责：把异常翻成前端能懂的 JSON，**并且不把内部细节漏出去**。
 * 前端 api() 只看 ok 和 error 两个字段。
 *
 * 附件相关的三个错误来自 database.js 里的 SQLite TRIGGER（RAISE(ABORT,...)），
 * 抛出来是纯英文标识符，这里翻译成中文 —— 前端不该看到 'ticket_attachment_bytes'。
 */
export async function endpoint(fn) {
  try {
    return await fn();
  } catch (e) {
    if (/ticket_attachment_bytes/.test(e.message)) {
      e.status = 413;
      e.message = '每个工单的附件合计不能超过 200 MB';
    }
    if (/ticket_attachment_limit/.test(e.message)) {
      e.status = 400;
      e.message = '每个工单最多 5 个附件';
    }
    if (/ticket_attachment_missing/.test(e.message)) {
      e.status = 400;
      e.message = '附件已失效，请重新上传';
    }

    // 业务错误：消息已经是为玩家写的，可以直接给
    if (e.status) return jsonError(e.status, e.message);

    // 唯一约束：换个说法，别把 SQL 细节抖出来
    if (/UNIQUE constraint/i.test(e.message)) {
      return jsonError(409, '该记录已存在，请勿重复提交');
    }

    // 其余一律兜底。错误细节只进服务端日志，不进响应体。
    console.error('[api]', e);
    return jsonError(500, '服务处理失败，请稍后重试');
  }
}
