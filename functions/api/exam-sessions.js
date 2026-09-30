import { endpoint, identity, body, string, fail, reply, integer } from '../_core/request.js';
import {
  generatePaper,
  publicSession,
  validateAnswers,
  objectiveResults,
  gradeShort,
  totals,
  event,
} from '../_core/exam-session.js';

/** 考试中还没结束的状态：前端用它决定「继续答题」还是「看结果」。 */
const LIVE_STATUSES = ['generating', 'in_progress', 'grading'];
const DONE_STATUSES = ['completed', 'needs_review'];

const playerActor = (p) => ({ type: 'player', id: p.id, name: p.username });

/** 取一份属于该玩家的试卷，不属于或不存在都统一 404（不泄露别人的卷子存在）。 */
async function owned(db, player, sessionId) {
  const row = await db
    .prepare('SELECT * FROM exam_sessions WHERE id=? AND player_id=?')
    .bind(string(sessionId, '试卷编号', 64), player.id)
    .first();
  if (!row) fail(404, '试卷不存在');
  return row;
}

/**
 * 落一次「评分完成」：更新成绩 + 事件 + 审计，串在一个 batch 里。
 * 返回主 UPDATE 的 changes —— 0 表示状态已被别人改掉，调用方要据此判断。
 */
async function finalize(db, row, results) {
  const summary = totals(results);
  const batchResult = await db.batch([
    db
      .prepare(
        "UPDATE exam_sessions SET results=?,score=?,known_score=?,pending_count=?,status=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND status='grading' AND revision=?"
      )
      .bind(
        JSON.stringify(results),
        summary.score,
        summary.known_score,
        summary.pending_count,
        summary.status,
        row.id,
        row.revision
      ),
    db
      .prepare(
        "INSERT INTO exam_session_events(session_id,actor_type,actor_name,action,details) SELECT ?,'system','考试评分','graded',? WHERE changes()=1"
      )
      .bind(row.id, JSON.stringify(summary)),
    db
      .prepare(
        "INSERT INTO audit_events(actor_type,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'system','考试评分','exam.graded','exam_sessions',?,200,? WHERE changes()=1"
      )
      .bind(row.id, JSON.stringify(summary)),
  ]);
  return batchResult[0].meta.changes;
}

/**
 * GET /api/exam-sessions
 *   ?id=        单份试卷详情（附该卷的复核申请）
 *   不带        列表：进行中的一份 + 最近 20 份历史
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const db = c.env.DB;
    const url = new URL(c.request.url);

    if (url.searchParams.has('id')) {
      const id = url.searchParams.get('id');
      const session = publicSession(await owned(db, player, id));
      const appeals = (
        await db
          .prepare(
            'SELECT question_id,status,original_score,reason,reply,created_at,resolved_at FROM exam_appeals WHERE session_id=? AND player_id=? ORDER BY id'
          )
          .bind(id, player.id)
          .all()
      ).results;
      return reply({ session, appeals });
    }

    const rows = (
      await db
        .prepare(
          'SELECT * FROM exam_sessions WHERE player_id=? ORDER BY created_at DESC,id DESC LIMIT 20'
        )
        .bind(player.id)
        .all()
    ).results;

    const active = rows.find((r) => LIVE_STATUSES.includes(r.status));
    const history = rows
      .filter((r) => DONE_STATUSES.includes(r.status))
      .map((r) => ({
        id: r.id,
        grade: r.grade,
        status: r.status,
        score: r.score,
        known_score: r.known_score,
        pending_count: r.pending_count,
        submitted_at: r.submitted_at,
      }));

    return reply({ active: active ? publicSession(active) : null, history });
  });

/**
 * POST /api/exam-sessions —— 四个 action：
 *   start     出新卷（会先回收卡死的 generating 卷）
 *   abandon   放弃
 *   recover   评分卡住时的补偿
 *   submit    交卷（默认）
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const db = c.env.DB;
    const action = input.action || 'start';

    if (action === 'start') return startSession(c, player, db, input);

    // 其余 action 都得先有一份属于自己的卷。
    const row = await owned(db, player, input.session_id);

    if (action === 'abandon') {
      if (!['in_progress', 'generating'].includes(row.status)) fail(409, '当前试卷不能放弃');
      await db.batch([
        db
          .prepare(
            "UPDATE exam_sessions SET status='abandoned',revision=revision+1,updated_at=datetime('now') WHERE id=? AND status IN ('in_progress','generating')"
          )
          .bind(row.id),
        event(db, row.id, playerActor(player), 'abandoned'),
      ]);
      return reply({ abandoned: true });
    }

    if (action === 'recover') {
      // 只有 grading 态才需要恢复，其它态直接回原样。
      if (row.status !== 'grading') return reply({ session: publicSession(row) });

      // 评分是异步的，2 分钟还没动静才算卡死。
      const stalled = await db
        .prepare(
          "SELECT id FROM exam_sessions WHERE id=? AND status='grading' AND updated_at<datetime('now','-2 minutes')"
        )
        .bind(row.id)
        .first();
      if (!stalled) return reply({ session: publicSession(row) }, 202);

      // 只用客观题结果收尾：卡死的简答留给人工复核，不重复调模型。
      await finalize(
        db,
        row,
        objectiveResults(JSON.parse(row.paper), JSON.parse(row.answers))
      );
      return reply({ session: publicSession(await owned(db, player, row.id)) });
    }

    return submitSession(c, player, db, input, row);
  });

/**
 * start：出新卷。
 * 唯一入口，容易叠出多张卷，所以有三道闸：
 *   1. 回收 2 分钟前卡在 generating 的卷
 *   2. 已有进行中的卷就返回它（resumed），不新开
 *   3. 一小时最多 6 张
 * 真正的插入靠 INSERT OR IGNORE 兜并发，抢不到就回读当前那张。
 */
async function startSession(c, player, db, input) {
  const grade = string(input.grade, '等级', 1);
  if (!['B', 'A', 'S'].includes(grade)) fail(400, '等级无效');

  // 出题可能耗时，卡死的 generating 卷留着会让玩家永远「恢复中」。
  await db
    .prepare(
      "UPDATE exam_sessions SET status='failed',updated_at=datetime('now') WHERE player_id=? AND status='generating' AND updated_at<datetime('now','-2 minutes')"
    )
    .bind(player.id)
    .run();

  const existing = await db
    .prepare(
      "SELECT * FROM exam_sessions WHERE player_id=? AND status IN ('generating','in_progress','grading')"
    )
    .bind(player.id)
    .first();
  // 正在出题的卷还没内容可看，用 202 让前端知道在等。
  if (existing) {
    return reply({ session: publicSession(existing), resumed: true }, existing.status === 'generating' ? 202 : 200);
  }

  if (!c.env.OPENAI_API_KEY) fail(503, '即时出题服务尚未配置，请联系管理员启用 AI 模型服务');

  const hourly = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM exam_sessions WHERE player_id=? AND created_at>datetime('now','-1 hour')"
    )
    .bind(player.id)
    .first();
  if (hourly.n >= 6) fail(429, '本小时已创建多份试卷，请稍后再试');

  const id = crypto.randomUUID();
  const claim = await db
    .prepare("INSERT OR IGNORE INTO exam_sessions(id,player_id,grade) VALUES(?,?,?)")
    .bind(id, player.id, grade)
    .run();
  // 抢不到说明并发的另一个请求已经建了：回读那张，不要再开一份。
  if (!claim.meta.changes) {
    const current = await db
      .prepare(
        "SELECT * FROM exam_sessions WHERE player_id=? AND status IN ('generating','in_progress','grading')"
      )
      .bind(player.id)
      .first();
    if (!current) fail(409, '考试状态已变化，请重试');
    return reply({ session: publicSession(current), resumed: true }, 202);
  }

  try {
    const paper = await generatePaper(c.env, grade);
    await db.batch([
      db
        .prepare(
          "UPDATE exam_sessions SET paper=?,status='in_progress',revision=1,updated_at=datetime('now') WHERE id=? AND status='generating'"
        )
        .bind(JSON.stringify(paper), id),
      db
        .prepare(
          "INSERT INTO exam_session_events(session_id,actor_type,actor_id,actor_name,action,details) SELECT ?,'player',?,?,'started',? WHERE changes()=1"
        )
        .bind(id, player.id, player.username, JSON.stringify({ grade, question_count: 5 })),
    ]);
    return reply({ session: publicSession(await owned(db, player, id)) }, 201);
  } catch (e) {
    // 出题失败要留痕成 failed，否则这张卷会永远占着 generating。
    await db
      .prepare(
        "UPDATE exam_sessions SET status='failed',updated_at=datetime('now') WHERE id=? AND status='generating'"
      )
      .bind(id)
      .run();
    throw e;
  }
}

/**
 * submit：交卷。
 * 先用乐观锁把卷子从 in_progress 抢成 grading（revision 必须匹配），
 * 再跑主观题评分，最后 finalize。
 */
async function submitSession(c, player, db, input, row) {
  // 幂等：重复点交卷不要重复批改。
  if (row.status === 'grading' || DONE_STATUSES.includes(row.status)) {
    return reply({ session: publicSession(row) }, row.status === 'grading' ? 202 : 200);
  }
  if (row.status !== 'in_progress') fail(409, '当前试卷不能交卷');

  const revision = integer(input.revision, '版本', 0);
  const paper = JSON.parse(row.paper);
  const answers = validateAnswers(paper, input.answers);
  // 客观题立刻判，主观题留 pending_review。
  const initial = objectiveResults(paper, answers);

  const claim = await db.batch([
    db
      .prepare(
        "UPDATE exam_sessions SET answers=?,results=?,status='grading',revision=revision+1,submitted_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status='in_progress' AND revision=?"
      )
      .bind(JSON.stringify(answers), JSON.stringify(initial), row.id, revision),
    db
      .prepare(
        "INSERT INTO exam_session_events(session_id,actor_type,actor_id,actor_name,action) SELECT ?,'player',?,?,'submitted' WHERE changes()=1"
      )
      .bind(row.id, player.id, player.username),
  ]);
  if (!claim[0].meta.changes) fail(409, '试卷已更新，请刷新后确认再交卷');

  const result = await gradeShort(c.env, paper, answers, initial);
  // finalize 里 +1 是因为上面那条 UPDATE 已经把 revision 推上去了。
  await finalize(db, { ...row, revision: revision + 1 }, result);
  return reply({ session: publicSession(await owned(db, player, row.id)) });
}

/** PATCH /api/exam-sessions —— 答题过程中自动保存，同样走 revision 乐观锁。 */
export const onRequestPatch = (c) =>
  endpoint(async () => {
    const player = await identity(c);
    const input = await body(c.request);
    const db = c.env.DB;
    const row = await owned(db, player, input.session_id);

    if (row.status !== 'in_progress') fail(409, '已交卷或无法继续编辑');

    const answers = validateAnswers(JSON.parse(row.paper), input.answers);
    const revision = integer(input.revision, '版本', 0);

    const result = await db
      .prepare(
        "UPDATE exam_sessions SET answers=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND player_id=? AND status='in_progress' AND revision=?"
      )
      .bind(JSON.stringify(answers), row.id, player.id, revision)
      .run();
    if (!result.meta.changes) fail(409, '其他页面已修改答卷，请刷新后再继续');

    // 回给前端下一个 revision，浏览器下次带上。
    return reply({ revision: revision + 1, saved: true });
  });
