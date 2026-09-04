// v50: 驾照模拟题库 (公开 GET / 玩家 POST 提交答案)
import { ok, err, handleOptions, getSession, readToken } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const grade = url.searchParams.get('grade') || 'B';
  const rows = await env.DB.prepare(
    'SELECT id, grade, question, options_json, sort_order FROM exam_questions WHERE grade = ? ORDER BY sort_order, id'
  ).bind(grade).all();
  // 隐藏 correct_index
  const out = (rows.results || []).map(r => ({
    id: r.id, grade: r.grade, question: r.question,
    options: JSON.parse(r.options_json || '[]'),
  }));
  return ok({ questions: out });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  const body = await request.json().catch(() => ({}));
  if (!body.grade || !Array.isArray(body.answers)) return err(400, 'grade/answers 必填');
  const qrows = await env.DB.prepare('SELECT id, correct_index, explanation FROM exam_questions WHERE grade = ?').bind(body.grade).all();
  const map = new Map((qrows.results || []).map(r => [r.id, r]));
  let score = 0, total = 0;
  const wrong = [];
  for (const a of body.answers) {
    total++;
    const r = map.get(a.id);
    if (r && r.correct_index === a.answer) score++;
    else wrong.push({ id: a.id, your: a.answer, correct: r?.correct_index, explanation: r?.explanation });
  }
  await env.DB.prepare(
    'INSERT INTO exam_attempts (player_id, grade, score, total, wrong_json) VALUES (?, ?, ?, ?, ?)'
  ).bind(sess.player_id, body.grade, score, total, JSON.stringify(wrong)).run();
  return ok({ score, total, wrong });
}
