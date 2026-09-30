import { endpoint, identity, body, string, integer, reply, fail } from '../../_core/request.js';

/**
 * 多选题判分用的规范化：去掉空白和分隔符后大写、按字符排序去重。
 * 这样 "A, b|c" 和 "BCA" 判为同一答案。
 */
const normalize = (s) =>
  [...new Set(s.toUpperCase().replace(/[\s,|]/g, '').split(''))].sort().join('');

/**
 * POST /api/exam-questions/answer —— 练习模式判一道题。
 *
 * 每次作答都落一条 exam_attempts 记录（供统计错题），但只回判分结果，
 * 不回正确答案之外的任何题目内容。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const questionId = integer(input.question_id);
    const answer = string(input.answer, '答案', 50);

    const question = await c.env.DB
      .prepare('SELECT answer,explanation,q_type FROM exam_questions WHERE id=?')
      .bind(questionId)
      .first();
    if (!question) fail(404, '题目不存在');

    const correct =
      question.q_type === 'multi'
        ? normalize(answer) === normalize(question.answer)
        : answer.toLowerCase() === question.answer.trim().toLowerCase();

    await c.env.DB
      .prepare('INSERT INTO exam_attempts(player_id,question_id,is_correct) VALUES(?,?,?)')
      .bind(player.id, questionId, correct ? 1 : 0)
      .run();

    return reply({
      is_correct: correct,
      correct_answer: question.answer,
      explanation: question.explanation,
    });
  });
