import { endpoint, integer, reply, string, fail } from '../_core/request.js';
import { searchKnowledge, fresh, citation } from '../_core/knowledge.js';

/**
 * 公开知识库查询。
 *
 * 两种入口：
 *   · 带 id  —— 取单篇，但仍要过三道关：已发布、面向公开、来源未更新
 *   · 带 q   —— 走检索
 *
 * source_hash 对不上（fresh() 为 false）也算取不到：来源变了而正文没改，
 * 等于给的是过期答案，这种情况下宁可让玩家转人工。
 */
export const onRequestGet = (context) =>
  endpoint(async () => {
    const url = new URL(context.request.url);
    let rows;

    if (url.searchParams.has('id')) {
      const row = await context.env.DB
        .prepare("SELECT * FROM knowledge_articles WHERE id=? AND status='published' AND audience='public'")
        .bind(integer(url.searchParams.get('id')))
        .first();
      if (!row || !(await fresh(context.env.DB, row))) {
        fail(404, '资料未发布或来源已更新，请联系人工核实');
      }
      rows = [row];
    } else {
      rows = await searchKnowledge(
        context.env.DB,
        string(url.searchParams.get('q') || '', '问题', 500, { required: false })
      );
    }

    return reply({
      articles: rows.map((r) => ({
        ...citation(r),
        question: r.question,
        answer: r.answer,
        updated_at: r.updated_at,
      })),
      note: '只检索已审核且来源有效的公开资料；未找到时请转人工。',
    });
  });
