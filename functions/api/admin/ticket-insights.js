import { endpoint, identity, reply } from '../../_core/request.js';
import { ticketReference } from '../../_core/ticket-policy.js';
import { accessibleTicket, searchKnowledge, similarity, citation } from '../../_core/knowledge.js';

/**
 * 工单的「相似工单 + 相关知识库」提示（只读）。
 *
 * 相似度是纯文字匹配（复用 knowledge.js 的 similarity），所以这里的
 * 相似工单**只是提示**，不是结论。返回结构里的 note 逐字说明了这一点：
 * 不代表同一事件、不代表相同责任，也不会自动合并 / 派单 / 办结。
 */

/** 正文可能存在 title/name 与 body/content 两套字段名，都要兜住 */
const ticketText = (row) => (row.title || row.name || '') + ' ' + (row.body || row.content || '');

/**
 * 攒出「当前管理员能看、但不是这一张单」的候选集。
 *
 * 排序按 id DESC 取最近 100 条：相似度只在最近工单里找，
 * 全表扫描既慢又会让久远的工单因为字面撞词而挤掉真正的近期同类。
 */
async function recentComparableTickets(db, admin, reference) {
  const conditions = ['id!=?'];
  const args = [reference.legacy ? -1 : reference.id];

  if (admin.role !== 'super') {
    // 普通管理员只看得到没有指名对象的单。
    conditions.push('target_admin_id IS NULL');
  } else {
    // 超管能看到指名单，但要排除「指名自己」的那些。
    conditions.push('(target_admin_id IS NULL OR target_admin_id!=?)');
    args.push(admin.id);
  }

  if (admin.linked_player_id) {
    // 管理员本人绑定的玩家，其相关单同样回避。
    conditions.push('(target_player_id IS NULL OR target_player_id!=?)');
    args.push(admin.linked_player_id);
  }

  const rows = await db
    .prepare(`SELECT id,title,body,status,kind FROM tickets WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 100`)
    .bind(...args)
    .all();

  return rows.results;
}

/** 相似度 ≥ 0.25 的留前 5 条，按分数从高到低 */
function rankSimilar(recent, query) {
  return recent
    .map((row) => ({ ...row, score: similarity(query, row.title + ' ' + row.body) }))
    .filter((row) => row.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      excerpt: row.body.slice(0, 160),
      score: row.score,
    }));
}

export const onRequestGet = (context) =>
  endpoint(async () => {
    const admin = await identity(context, 'admin');

    const reference = ticketReference(new URL(context.request.url).searchParams.get('id'));
    const db = context.env.DB;
    // 先过 accessibleTicket：这张单本身无权看就到此为止，不做后面的检索。
    const ticket = await accessibleTicket(db, admin, reference);

    const recent = await recentComparableTickets(db, admin, reference);
    const query = ticketText(ticket);
    const similar = rankSimilar(recent, query);

    const knowledge = await searchKnowledge(db, query, ['public', 'staff']);

    return reply({
      similar,
      knowledge: knowledge.map((row) => ({ ...citation(row), answer: row.answer, audience: row.audience })),
      note: '相似性只按最近 100 条有权查看的工单文字匹配，不代表同一事件或相同责任；不会自动合并、派单或办结。',
    });
  });
