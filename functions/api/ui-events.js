import { endpoint, body, string, reply, fail } from '../_core/request.js';
import { auditActor, auditStatement } from '../_core/audit.js';

/** 目前只埋「导出」这一类前端操作 */
const ACTIONS = ['export'];

/** 单次请求最多记多少条：埋点是附加能力，不能让人拿它灌库 */
const MAX_EVENTS = 30;

export const onRequestPost = (context) =>
  endpoint(async () => {
    const input = await body(context.request);
    if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) fail(400, '事件格式无效');

    // 走真库：这是用户自己触发的操作，要记在他名下，不能记成系统动作
    const db = context.audit?.base || context.env.DB;
    const actor = context.audit?.actor || (await auditActor(db, context.request));

    const events = input.events.map((e) => {
      if (!ACTIONS.includes(e.action)) fail(400, '事件类型无效');
      return {
        action: 'ui.' + e.action,
        resource_type: 'ui',
        resource_id: string(e.element || 'page', '元素', 100),
        path: string(e.page || '/', '页面', 200),
        details: { label: string(e.label || '', '操作', 120, { required: false }) },
        status: 200,
        request_id: context.audit?.requestId,
      };
    });

    await db.batch(events.map((e) => auditStatement(db, actor, e)));
    return reply({ recorded: events.length });
  });
