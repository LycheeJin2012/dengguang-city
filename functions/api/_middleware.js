import { recordSuccessfulLogin } from '../_core/login-history.js';
import { shouldAudit, auditResource } from '../_core/audit-policy.js';
import { ensureDatabase, SCHEMA_VERSION } from '../_core/database.js';
import { endpoint, fail } from '../_core/request.js';
import { auditActor, auditStatement, auditedDatabase } from '../_core/audit.js';

/** 只读方法：不改数据，也就用不着跨站写入防护 */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** 2 MB，与 _core/request.js 里 body() 的上限保持一致 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const isJson = (message) => !!message.headers.get('Content-Type')?.includes('application/json');

/**
 * 审计事件里的 resource_id：URL 上的 ?id= 优先，缺失时再从 JSON body 里捞。
 *
 * 捞不到 / body 不是 JSON / 解析抛错都按「没有 id」处理 —— 审计是附加能力，
 * 绝不能反过来把一个本来正常的请求打挂，所以这里吞掉所有异常。
 */
async function resourceIdFromBody(request, resourceType) {
  try {
    const input = await request.clone().json();
    const id =
      resourceType === 'admins' ? input.admin_id
      : resourceType === 'players' ? input.player_id
      : input.id;
    if (Number.isSafeInteger(Number(id)) && Number(id) > 0) return String(id);
  } catch {
    // 解析不了就算了
  }
  return null;
}

/**
 * 写请求的跨站防护。
 *
 * Origin / Sec-Fetch-Site 是浏览器自己带的头，攻击者用脚本伪造不了；
 * 没有 Origin 的（curl、服务端调用）默认放行，否则所有内部调用都会挂。
 */
function guardCrossSiteWrite(request, url) {
  if (SAFE_METHODS.includes(request.method)) return;

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) fail(403, '不接受其他网站发起的写入请求');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, '不接受跨站写入请求');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
    fail(413, '请求内容过大');
  }
}

/**
 * 请求结束后的审计落库。
 *
 * 记的是「这次请求实际做了什么」，所以要等响应出来之后才知道状态码和
 * 资源 id。/api/ui-events 是前端埋点，量巨大且无审计价值，单独排除。
 */
async function writeAudit({ base, request, response, event, actor, tracked, url }) {
  if (url.pathname === '/api/ui-events' || !tracked) return;

  // 登录类响应会种新 cookie：审计身份要换成新会话对应的账号，
  // 否则「登录成功」这条记录会挂在匿名身份上。
  const setCookie = response.headers.get('Set-Cookie');
  let effective = actor;
  if (setCookie && response.ok) {
    const token = /lc_session=([^;]+)/.exec(setCookie)?.[1];
    if (token) effective = await auditActor(base, request, token);
  }

  const action =
    url.pathname === '/api/support'
      ? (response.status === 201 ? 'support.requested' : 'support.checked')
      : url.searchParams.get('export') === '1'
        ? 'export'
        : url.searchParams.get('action') || request.method.toLowerCase();

  // 创建类请求返回体里带新资源 id；passkey-* 的返回体是 WebAuthn 数据，没有业务 id
  let resourceId = event.resource_id;
  if (!resourceId && response.ok && request.method === 'POST' && isJson(response)) {
    try {
      const result = await response.clone().json();
      resourceId = (url.searchParams.get('action') || '').startsWith('passkey-')
        ? null
        : result.id || result.user_id || result.user?.id || null;
      // 注册申请人此刻还不是「玩家」，单独记成 applicant，否则查审计会指不到人
      if (url.pathname === '/api/register' && result.user) {
        effective = { type: 'applicant', id: result.user.id, name: result.user.username };
      }
    } catch {
      // 响应不是 JSON 就没 id
    }
  }

  await auditStatement(base, effective, {
    ...event,
    action,
    resource_type: event.resource_type,
    resource_id: resourceId,
    status: response.status,
    details: { action: url.searchParams.get('action') || null },
  }).run();
}

/** 给每个响应补上统一的缓存与安全头 */
function finalize(response, requestId) {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Request-Id', requestId);
  result.headers.set('X-App-Schema-Version', String(SCHEMA_VERSION));
  return result;
}

export async function onRequest(context) {
  return endpoint(async () => {
    const { request, env } = context;
    const url = new URL(request.url);
    if (!env.DB) fail(503, '数据库尚未连接，请联系管理员');
    await ensureDatabase(env.DB);

    const actor = await auditActor(env.DB, request);
    const requestId = crypto.randomUUID();
    const tracked = shouldAudit(request);
    const event = {
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      resource_id: url.searchParams.get('id'),
      resource_type: auditResource(url),
      details: {},
    };
    if (!event.resource_id && tracked && isJson(request)) {
      event.resource_id = (await resourceIdFromBody(request, event.resource_type)) || event.resource_id;
    }

    // context.audit 放未包装的真库：系统级动作（如自动派单）要绕开「按玩家记审计」的包装，
    // 否则那条系统记录会被记成发起请求的那个玩家。
    const base = env.DB;
    context.audit = { actor, requestId, base };
    context.env = { ...env, DB: tracked ? auditedDatabase(base, actor, event) : base };

    let response;
    try {
      guardCrossSiteWrite(request, url);
      response = await context.next();
    } catch (error) {
      // 路由里的 fail() 抛的是 HttpError，交给 endpoint 翻成标准错误响应
      response = await endpoint(async () => {
        throw error;
      });
    }

    try {
      await recordSuccessfulLogin(base, request, response);
    } catch {
      // 登录历史只是安全侧写，挂了不该影响主流程
      console.error('[login-history] security history unavailable');
    }

    await writeAudit({ base, request, response, event, actor, tracked, url });
    return finalize(response, requestId);
  });
}
