// v47: 驾照模拟题库 API
// GET  /api/exam-questions?grade=B|A|S&limit=20&random=1   - 拉题 (公开, 用于练习)
// GET  /api/exam-questions?my=1                            - 我的练习历史
// POST /api/exam-questions   body: {grade, q_type, question, options, answer, explanation}
//        管理员入库
// POST /api/exam-questions/answer   body: {question_id, is_correct}
//        玩家提交练习结果, 写 exam_attempts

import { ok, err, readToken, getSession } from '../_shared.js';

const GRADES = new Set(['B', 'A', 'S']);
const Q_TYPES = new Set(['choice', 'multi', 'judge']);

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);

  if (url.searchParams.get('my') === '1') {
    const token = readToken(request);
    const sess = await getSession(env, token);
    if (!sess || !sess.player_id) return err(401, '请先登录');
    const rows = await env.DB.prepare(
      `SELECT q.id, q.grade, q.question, ea.is_correct, ea.created_at
       FROM exam_attempts ea
       JOIN exam_questions q ON q.id = ea.question_id
       WHERE ea.player_id = ?
       ORDER BY ea.created_at DESC LIMIT 50`
    ).bind(sess.player_id).all();
    // 错题去重
    const wrongSet = new Map();
    for (const r of rows.results || []) {
      if (!r.is_correct && !wrongSet.has(r.id)) wrongSet.set(r.id, r);
    }
    return ok({ attempts: rows.results, wrong_book: [...wrongSet.values()] });
  }

  const grade = url.searchParams.get('grade') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);
  const random = url.searchParams.get('random') === '1';
  if (!GRADES.has(grade)) return err(400, 'grade 必填 B/A/S');

  const rows = random
    ? await env.DB.prepare(
        `SELECT id, grade, q_type, question, options, explanation FROM exam_questions
         WHERE grade = ? ORDER BY RANDOM() LIMIT ?`
      ).bind(grade, limit).all()
    : await env.DB.prepare(
        `SELECT id, grade, q_type, question, options, explanation FROM exam_questions
         WHERE grade = ? ORDER BY id LIMIT ?`
      ).bind(grade, limit).all();
  // 解析 options JSON
  const questions = (rows.results || []).map(q => ({
    ...q,
    options: q.options ? JSON.parse(q.options) : null,
  }));
  // 故意不返回 answer 字段 (防作弊, 提交答案时服务端验证)
  return ok({ questions });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const path = url.pathname; // e.g. /api/exam-questions/answer

  if (path.endsWith('/answer')) {
    return recordAnswer(env, request);
  }
  return createQuestion(env, request);
}

async function recordAnswer(env, request) {
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

async function createQuestion(env, request) {
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(401, '需要管理员登录');
  const body = await request.json().catch(() => ({}));
  const grade = (body.grade || '').toString().toUpperCase();
  const qType = (body.q_type || 'choice').toString();
  const question = (body.question || '').toString().trim();
  const options = body.options; // array or null
  const answer = (body.answer || '').toString().trim();
  const explanation = (body.explanation || '').toString().trim();
  if (!GRADES.has(grade)) return err(400, 'grade 必须是 B/A/S');
  if (!Q_TYPES.has(qType)) return err(400, 'q_type 必须是 choice/multi/judge');
  if (!question) return err(400, 'question 必填');
  if (!answer) return err(400, 'answer 必填');
  if (qType !== 'judge' && (!Array.isArray(options) || options.length < 2)) {
    return err(400, 'options 必填且至少 2 项');
  }
  const r = await env.DB.prepare(
    `INSERT INTO exam_questions (grade, q_type, question, options, answer, explanation)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(grade, qType, question, options ? JSON.stringify(options) : null, answer, explanation || null).run();
  return ok({ id: r.meta?.last_row_id });
}
