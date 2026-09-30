import { endpoint, identity, body, string, integer, fail, reply } from '../../_core/request.js';
import { totals } from '../../_core/exam-session.js';

/** 管理员如果本人也考了这场，就不能复核自己的卷子（自评等于放水） */
const assertNotOwnPaper = (admin, playerId) => {
  if (admin.linked_player_id === playerId) fail(403, '不能复核自己的试卷');
};

/** 单份试卷的完整详情：题目、答卷、逐题结果和操作流水 */
async function sessionDetail(db, admin, sessionId) {
  const row = await db
    .prepare('SELECT s.*,p.username FROM exam_sessions s JOIN players p ON p.id=s.player_id WHERE s.id=?')
    .bind(sessionId)
    .first();
  if (!row) fail(404, '试卷不存在');
  // 先判权限再读详情，避免管理员碰见自己那份卷子的内容
  assertNotOwnPaper(admin, row.player_id);

  return {
    row,
    appeals: (await db.prepare('SELECT * FROM exam_appeals WHERE session_id=? ORDER BY id').bind(row.id).all()).results,
    events: (
      await db
        .prepare('SELECT actor_name,actor_id,action,details,created_at FROM exam_session_events WHERE session_id=? ORDER BY id')
        .bind(row.id)
        .all()
    ).results,
  };
}

export const onRequestGet = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'admin');
    const db = c.env.DB;
    const url = new URL(c.request.url);

    if (url.searchParams.has('id')) {
      const { row, appeals, events } = await sessionDetail(db, admin, url.searchParams.get('id'));
      return reply({
        appeals,
        session: {
          ...row,
          paper: JSON.parse(row.paper),
          answers: JSON.parse(row.answers),
          results: JSON.parse(row.results || '[]'),
        },
        events,
      });
    }

    // 待办清单：需要人工复核的，和玩家申诉还没处理的；
    // 第二个子查询把管理员自己考过的卷子排掉（linked_player_id 为空时不过滤）。
    const rows = (
      await db
        .prepare(
          "SELECT s.id,s.grade,s.pending_count,s.known_score,s.submitted_at,p.username,(SELECT COUNT(*) FROM exam_appeals x WHERE x.session_id=s.id AND x.status='pending') AS appeal_count FROM exam_sessions s JOIN players p ON p.id=s.player_id WHERE (s.status='needs_review' OR EXISTS(SELECT 1 FROM exam_appeals x WHERE x.session_id=s.id AND x.status='pending')) AND (? IS NULL OR s.player_id!=?) ORDER BY s.submitted_at LIMIT 100"
        )
        .bind(admin.linked_player_id, admin.linked_player_id)
        .all()
    ).results;
    return reply({ sessions: rows });
  });

/** 得分 → 反馈代码：满分「已达到本题要求」，0 分「答非所问」，其余「部分覆盖」 */
const feedbackCode = (score) => (score === 20 ? 'complete' : score === 0 ? 'off_topic' : 'partial');

export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'admin');
    const input = await body(c.request);
    const db = c.env.DB;

    const row = await db
      .prepare('SELECT * FROM exam_sessions WHERE id=?')
      .bind(string(input.session_id, '试卷编号', 64))
      .first();
    if (!row) fail(404, '试卷不存在');
    assertNotOwnPaper(admin, row.player_id);
    if (!['completed', 'needs_review'].includes(row.status)) fail(409, '试卷不能复核');

    const appeal = await db
      .prepare("SELECT * FROM exam_appeals WHERE session_id=? AND question_id=? AND status='pending'")
      .bind(row.id, input.question_id)
      .first();

    const revision = integer(input.revision, '版本', 0);
    const reason = string(input.reason, '复核说明', 500);

    const results = JSON.parse(row.results);
    const question = JSON.parse(row.paper).questions.find((q) => q.id === input.question_id);
    // 只有两种情况值得人工看：AI 判不了的主观题，或玩家对这个题提了申诉
    const result = results.find((r) => r.question_id === input.question_id && (r.status === 'pending_review' || appeal));
    if (!question || !result) fail(400, '该题不需要复核');

    // 有申诉才要求写给玩家的答复，纯 AI 待复核的题没有对外回复
    const externalReply = appeal ? string(input.reply, '给玩家的复核答复', 500) : '';
    const score = integer(input.score, '得分', 0, 20);

    result.score = score;
    result.status = 'graded';
    result.grading_source = 'admin';
    result.reviewer_id = admin.id;
    result.reviewer_name = admin.username;
    result.feedback_code = feedbackCode(score);

    const next = totals(results);
    const details = JSON.stringify({ question_id: question.id, score, reason });

    // 乐观锁：revision 必须仍是前端带来的那个，否则说明别人先改过这题。
    // 后面每条语句都挂 WHERE changes()=1，保证只有真正落库的那条会写事件。
    const operations = [
      db
        .prepare(
          "UPDATE exam_sessions SET results=?,score=?,known_score=?,pending_count=?,status=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status IN ('completed','needs_review')"
        )
        .bind(JSON.stringify(results), next.score, next.known_score, next.pending_count, next.status, row.id, revision),
      db
        .prepare("INSERT INTO exam_session_events(session_id,actor_type,actor_id,actor_name,action,details) SELECT ?,'admin',?,?,'reviewed',? WHERE changes()=1")
        .bind(row.id, admin.id, admin.username, details),
      db
        .prepare("INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,'exam.reviewed','exam_sessions',?,200,? WHERE changes()=1")
        .bind(admin.id, admin.username, row.id, details),
    ];

    // 申诉结案：要求本轮 revision 正好是 +1，跨过这次复核直接改申诉会张冠李戴
    if (appeal) {
      operations.push(
        db
          .prepare(
            "UPDATE exam_appeals SET status='resolved',reply=?,reviewer_id=?,resolved_at=datetime('now') WHERE id=? AND status='pending' AND changes()=1 AND EXISTS(SELECT 1 FROM exam_sessions WHERE id=? AND revision=?)"
          )
          .bind(externalReply, admin.id, appeal.id, row.id, revision + 1)
      );
    }

    operations.push(
      db
        .prepare("INSERT INTO notification_log(player_id,type,title,body,link) SELECT ?,'exam_review','考试成绩复核有更新','请在玩家主页的模拟考试中查看答卷与复核答复。','/profile.html' WHERE changes()=1")
        .bind(row.player_id)
    );

    const applied = await db.batch(operations);
    if (!applied[0].meta.changes) fail(409, '已被其他管理员修改，请刷新');
    return reply({ reviewed: true });
  });
