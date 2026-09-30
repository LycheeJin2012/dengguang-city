import { endpoint, identity, body, reply } from '../../_core/request.js';
import { ticketReference, ticketEvent } from '../../_core/ticket-policy.js';
import { accessibleTicket } from '../../_core/knowledge.js';
import { triageTicket } from '../../_core/triage.js';

export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'admin');
    const input = await body(c.request);
    const ref = ticketReference(input.ticket_id);
    const db = c.env.DB;

    // 权限先过：被投诉的工单管理员根本不该看见
    await accessibleTicket(db, admin, ref);

    // 解除人工锁定后重跑一次自动分流，让工单按最新规则重新定级/定优先级
    await db.batch([
      db
        .prepare('UPDATE ticket_triage SET manual=0,updated_by=? WHERE ticket_ref=?')
        .bind(admin.id, ref.ref),
      ticketEvent(db, ref.ref, { type: 'admin', id: admin.id, name: admin.username }, 'triage_resumed', {}),
    ]);

    await triageTicket(c, ref.ref);

    return reply({
      triage: await db.prepare('SELECT * FROM ticket_triage WHERE ticket_ref=?').bind(ref.ref).first(),
    });
  });
