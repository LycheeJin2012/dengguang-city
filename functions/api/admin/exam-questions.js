import { endpoint, identity, body, integer, reply, fail } from '../../_core/request.js';
import { validateQuestion } from '../exam-questions.js';

/**
 * 列表 / 新建 / 改题。
 *
 * 题目一旦被玩家答过就带着练习历史，所以这里**没有 DELETE**：
 * 删题会连带让历史练习失去参照。别的入口想删题时，方法分发直接 405。
 */
export const onRequest = (context) =>
  endpoint(async () => {
    await identity(context, 'admin');

    if (context.request.method === 'GET') {
      const questions = await context.env.DB.prepare(
        'SELECT * FROM exam_questions ORDER BY grade,id DESC LIMIT 500'
      ).all();
      return reply({ questions: questions.results });
    }

    if (context.request.method === 'POST' || context.request.method === 'PATCH') {
      // validateQuestion 固定按 grade,q_type,question,options,answer,explanation 顺序返回，
      // 下面两条 SQL 的列顺序必须与之一一对应，展开即可，不必逐个点名。
      const fields = Object.values(validateQuestion(await body(context.request)));

      if (context.request.method === 'POST') {
        const inserted = await context.env.DB.prepare(
          'INSERT INTO exam_questions(grade,q_type,question,options,answer,explanation) VALUES(?,?,?,?,?,?)'
        )
          .bind(...fields)
          .run();
        return reply({ id: inserted.meta.last_row_id }, 201);
      }

      const id = new URL(context.request.url).searchParams.get('id');
      const updated = await context.env.DB.prepare(
        'UPDATE exam_questions SET grade=?,q_type=?,question=?,options=?,answer=?,explanation=? WHERE id=?'
      )
        .bind(...fields, integer(id))
        .run();

      // changes() 是唯一的「真改到了」信号：id 不存在时不能回一句 updated:true。
      if (!updated.meta.changes) fail(404, '题目不存在');
      return reply({ updated: true });
    }

    fail(405, '请编辑题目以保留练习历史');
  });
