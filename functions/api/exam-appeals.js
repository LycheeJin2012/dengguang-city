import { endpoint, identity, reply, string, fail, body } from '../_core/request.js';

/** ?kind= 的默认目录。 */
const DEFAULT_KIND = 'players';

/**
 * GET /api/exam-appeals —— 列出当前玩家对某份答卷提过的复核申请。
 * 严格按 player_id + session_id 过滤，看不到别人的答卷。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const sessionId = new URL(c.request.url).searchParams.get('session_id');
    const appeals = (
      await c.env.DB
        .prepare(
          'SELECT id,session_id,question_id,original_score,reason,status,reply,created_at,resolved_at FROM exam_appeals WHERE player_id=? AND session_id=? ORDER BY id'
        )
        .bind(player.id, sessionId)
        .all()
    ).results;
    return reply({ appeals });
  });

/**
 * POST /api/exam-appeals —— 对已批改的某一道题申请人工复核。
 *
 * 只能对 status='graded' 的题发起；还在等 AI 批改（pending_review）的题
 * 直接 409，因为那时还没有 original_score 可争。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const db = c.env.DB;

    const sessionId = string(input.session_id, '答卷编号', 64);
    const questionId = string(input.question_id, '题目编号', 64);
    const reason = string(input.reason, '复核理由', 1000);

    // 归属校验：必须是本人的、且已交卷的答卷。
    const session = await db
      .prepare(
        "SELECT results,status FROM exam_sessions WHERE id=? AND player_id=? AND status IN ('completed','needs_review')"
      )
      .bind(sessionId, player.id)
      .first();
    if (!session) fail(404, '已交答卷不存在');

    const result = JSON.parse(session.results || '[]').find((r) => r.question_id === questionId);
    if (!result || result.status !== 'graded' || !Number.isInteger(result.score)) {
      fail(409, '该题尚未完成批改，已在等待复核');
    }

    // 已提过就回显原单，不让重复提交刷记录。
    const existing = await db
      .prepare('SELECT id,status FROM exam_appeals WHERE session_id=? AND question_id=?')
      .bind(sessionId, questionId)
      .first();
    if (existing) return reply({ id: existing.id, status: existing.status, existing: true });

    // 三条语句串在一次 batch 里，靠 changes()=1 保证事件/审计只在本单真建出来时才写。
    const batchResult = await db.batch([
      db
        .prepare(
          'INSERT OR IGNORE INTO exam_appeals(session_id,question_id,player_id,original_score,reason) VALUES(?,?,?,?,?)'
        )
        .bind(sessionId, questionId, player.id, result.score, reason),
      db
        .prepare(
          "INSERT INTO exam_session_events(session_id,actor_type,actor_id,actor_name,action,details) SELECT ?,'player',?,?,'appeal_requested',? WHERE changes()=1"
        )
        .bind(
          sessionId,
          player.id,
          player.username,
          JSON.stringify({ question_id: questionId, reason, original_score: result.score })
        ),
      db
        .prepare(
          "INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'player',?,?,'exam.appeal_requested','exam_sessions',?,201,? WHERE changes()=1"
        )
        .bind(
          player.id,
          player.username,
          sessionId,
          JSON.stringify({ question_id: questionId, original_score: result.score })
        ),
    ]);

    // 用 INSERT OR IGNORE 兜住了并发重复提交，所以要回查拿权威 id/status。
    const saved = await db
      .prepare('SELECT id,status FROM exam_appeals WHERE session_id=? AND question_id=?')
      .bind(sessionId, questionId)
      .first();
    return reply(saved, batchResult[0].meta.changes ? 201 : 200);
  });
