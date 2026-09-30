import { auditStatement } from '../../_core/audit.js';
import { endpoint, identity, body, integer, reply, fail } from '../../_core/request.js';
import { settings, administrators, preferences, experience } from '../../_core/dispatch.js';

export const onRequestGet = (c) =>
  endpoint(async () => {
    await identity(c, 'admin');
    const config = await settings(c.env.DB);
    const admins = await administrators(c.env.DB);
    const preferred = preferences(admins, config);
    return reply({
      config,
      admins,
      preferred,
      experience: await experience(c.env.DB),
      ai_configured: !!c.env.OPENAI_API_KEY,
    });
  });

/** 派单策略的四个可改字段；紧急/复杂承办人是「留空即交给规则自动匹配」 */
const ADMIN_ID_FIELDS = ['urgent_admin_id', 'complex_admin_id'];

export const onRequestPatch = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'super');
    // 改策略本身也要审计：before 存的是改动前的完整配置，事后能还原是谁把派单关掉的
    const before = await settings(c.env.DB);
    const input = await body(c.request);
    const values = {};

    if (input.enabled !== undefined) {
      if (![true, false, 0, 1].includes(input.enabled)) fail(400, '自动派单开关无效');
      values.enabled = input.enabled ? 1 : 0;
    }
    if (input.max_active !== undefined) {
      values.max_active = integer(input.max_active, '最大在办工单数', 1, 100);
    }
    for (const key of ADMIN_ID_FIELDS) {
      if (input[key] === undefined) continue;
      values[key] = input[key] ? integer(input[key]) : null;
      // 指派对象必须真实存在，否则派单会一直挑到一个空承办人
      if (values[key] && !(await c.env.DB.prepare('SELECT id FROM admins WHERE id=?').bind(values[key]).first())) {
        fail(404, '管理员不存在');
      }
    }
    if (!Object.keys(values).length) fail(400, '没有修改字段');

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE dispatch_settings SET ${Object.keys(values).map((k) => k + '=?').join(',')},revision=revision+1,updated_at=datetime('now') WHERE id=1`
        )
        .bind(...Object.values(values)),
      auditStatement(
        c.env.DB,
        { type: 'admin', id: admin.id, name: admin.username },
        {
          request_id: c.audit?.requestId,
          action: 'dispatch.policy_changed',
          resource_type: 'dispatch_settings',
          resource_id: 1,
          method: 'PATCH',
          path: '/api/admin/dispatch-settings',
          status: 200,
          details: { before, changes: values },
        }
      ),
    ]);

    return reply({ updated: true, id: 1 });
  });
