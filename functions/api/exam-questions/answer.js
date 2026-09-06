// v49-fix-11: POST /api/exam-questions/answer 拆成独立文件
// 之前在 exam-questions.js 里用 path.endsWith('/answer') 路由, 但 CF Pages Functions
// 是目录路由: /api/exam-questions/answer 会找 functions/api/exam-questions/answer.js
// 找不到 -> 405. 现在把 recordAnswer 逻辑搬到这里, 跟其它 admin/* 端点一致 (目录式).
import { ok, err, readToken, getSession } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return err(401, '请先登录');
  const body = await request.json().catch(() => ({}));
  const qid = parseInt(body.question_id || 0, 10);
  const answer = (body.answer || '').toString().trim();
  if (!qid || !answer) return err(400, 'question_id/answer 必填');

  const q = await env.DB.prepare('SELECT answer, explanation FROM exam_questions WHERE id = ?').bind(qid).first();
  if (!q) return err(404, '题目不存在');

  // 答案比对: 多选按排序后比较, 判断按 'true'/'false'
  const correct = (q.answer || '').toString().trim();
  let isCorrect = false;
  if (answer.includes('|')) {
    const a = answer.split('|').sort().join('');
    const c = correct.split(/[,|]/).map(s => s.trim()).filter(Boolean).sort().join('');
    isCorrect = a === c;
  } else {
    isCorrect = answer.toLowerCase() === correct.toLowerCase();
  }
  await env.DB.prepare(
    'INSERT INTO exam_attempts (player_id, question_id, is_correct) VALUES (?, ?, ?)'
  ).bind(sess.player_id, qid, isCorrect ? 1 : 0).run();
  return ok({ is_correct: isCorrect, correct_answer: correct, explanation: q.explanation });
}
