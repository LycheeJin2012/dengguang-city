import { endpoint, identity, body, string, integer, reply, fail } from '../../_core/request.js';
import { sourceDocument, digest, fresh, searchKnowledge } from '../../_core/knowledge.js';

const AUDIENCES = ['public', 'staff', 'exam'];
const SOURCE_KINDS = ['guide', 'announcement', 'license', 'exam', 'ticket'];

/** 从任意来源文档 / 表单里抠出知识条目的四个可编辑字段 */
const values = (b) => ({
  title: string(b.title, '标题', 150),
  question: string(b.question, '适用问题', 1000),
  answer: string(b.answer, '知识正文', 4000),
  keywords: string(b.keywords || '', '关键词', 300, { required: false }),
});

/** 抽取测试 / 人工同步时的统一失败文案 */
const SOURCE_UNAVAILABLE = '来源不可用；工单仅支持已办结且审核公开的内容';

export const onRequestGet = (c) =>
  endpoint(async () => {
    await identity(c, 'super');
    const url = new URL(c.request.url);
    const db = c.env.DB;
    const action = url.searchParams.get('action');

    if (action === 'history') {
      const versions = await db
        .prepare('SELECT * FROM knowledge_versions WHERE article_id=? ORDER BY revision DESC LIMIT 100')
        .bind(integer(url.searchParams.get('id')))
        .all();
      return reply({ versions: versions.results });
    }

    // 可选来源清单：把散落在各业务表里、还没被做成知识条目的素材一次列出来
    if (action === 'sources') {
      const announcements = await db
        .prepare("SELECT id,title,'announcement' AS kind FROM announcements ORDER BY id DESC LIMIT 100")
        .all();
      const licenses = await db
        .prepare("SELECT id,title,'license' AS kind FROM license_requirements WHERE is_active=1 ORDER BY id LIMIT 100")
        .all();
      const questions = await db
        .prepare("SELECT id,question AS title,'exam' AS kind FROM exam_questions ORDER BY id LIMIT 100")
        .all();
      const tickets = await db
        .prepare(
          "SELECT id,public_title AS title,'ticket' AS kind FROM tickets WHERE public_consent=1 AND public_visible=1 AND status IN ('resolved','closed') AND public_reply IS NOT NULL AND source_table IS NOT 'support' ORDER BY id DESC LIMIT 100"
        )
        .all();
      return reply({
        sources: [...announcements.results, ...licenses.results, ...questions.results, ...tickets.results],
      });
    }

    if (action === 'test') {
      const rows = await searchKnowledge(db, string(url.searchParams.get('q'), '测试问题', 500));
      return reply({
        articles: rows.map((r) => ({ id: r.id, title: r.title, answer: r.answer, score: r.score })),
        mode: 'public_retrieval',
        note: '测试只读，不会发送客服回复。',
      });
    }

    // 列表：audience / cursor / q 都是可选过滤条件，逐个拼进 WHERE
    const limit = 100;
    const args = [];
    const clauses = [];
    if (AUDIENCES.includes(url.searchParams.get('audience'))) {
      clauses.push('audience=?');
      args.push(url.searchParams.get('audience'));
    }
    if (url.searchParams.has('cursor')) {
      clauses.push('id<?');
      args.push(integer(url.searchParams.get('cursor')));
    }
    if (url.searchParams.get('q')) {
      clauses.push('(title LIKE ? OR question LIKE ?)');
      args.push('%' + url.searchParams.get('q') + '%', '%' + url.searchParams.get('q') + '%');
    }

    const rows = (
      await db
        .prepare(`SELECT * FROM knowledge_articles ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
        .bind(...args, limit)
        .all()
    ).results;
    for (const r of rows) r.source_valid = await fresh(db, r);

    // 翻满一页才给游标，否则说明到底了，前端该停
    return reply({ articles: rows, next_cursor: rows.length === limit ? rows.at(-1).id : null });
  });

export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'super');
    const input = await body(c.request);
    const db = c.env.DB;
    const kind = input.source_kind || 'manual';

    let v;
    let sourceId = null;
    let hash = null;
    if (kind === 'manual') {
      v = values(input);
    } else {
      if (!SOURCE_KINDS.includes(kind)) fail(400, '资料来源无效');
      sourceId = integer(input.source_id);
      v = await sourceDocument(db, kind, sourceId);
      if (!v || !v.answer) fail(404, SOURCE_UNAVAILABLE);
      // 存下来源指纹：之后每次展示前都比对，来源变了这条知识就该自动失效
      hash = await digest(v);
      // 同步过来的内容仍允许管理员改标题/关键词等展示字段
      v = { ...v, ...values(v) };
    }

    const audience = v.audience || input.audience || 'public';
    if (!AUDIENCES.includes(audience)) fail(400, '适用范围无效');

    // 一条知识 + 第一版快照 + 审计，三步必须同生共死
    const result = await db.batch([
      db
        .prepare(
          'INSERT OR IGNORE INTO knowledge_articles(title,question,answer,keywords,audience,source_kind,source_id,source_hash,created_by) VALUES(?,?,?,?,?,?,?,?,?)'
        )
        .bind(v.title, v.question, v.answer, v.keywords, audience, kind, sourceId, hash, admin.id),
      db
        .prepare(
          "INSERT INTO knowledge_versions(article_id,revision,payload,actor_id,actor_name,action) SELECT last_insert_rowid(),1,?,?,?,'created' WHERE changes()=1"
        )
        .bind(JSON.stringify({ ...v, audience, status: 'draft', source_kind: kind, source_id: sourceId, source_hash: hash }), admin.id, admin.username),
      db
        .prepare(
          "INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,'knowledge.draft_created','knowledge_articles',CAST(last_insert_rowid() AS TEXT),201,? WHERE changes()=1"
        )
        .bind(admin.id, admin.username, JSON.stringify({ source_kind: kind, source_id: sourceId, audience })),
    ]);

    // 同一个来源只留一条：被 UNIQUE 索引挡下时回报既有 id，前端据此跳过去编辑
    if (!result[0].meta.changes) {
      const existing = await db
        .prepare('SELECT id FROM knowledge_articles WHERE source_kind=? AND source_id=?')
        .bind(kind, sourceId)
        .first();
      return reply({ id: existing.id, existing: true });
    }
    return reply({ id: result[0].meta.last_row_id, status: 'draft' }, 201);
  });

/**
 * 算出这次审核要落库的字段。
 *
 * 动作语义：
 *   refresh  重新从来源同步，同时刷新指纹
 *   publish  人工核对后发布，前提是来源还没变
 *   retract  撤回
 *   其他/缺省  直接改字段
 */
async function reviewTarget(old, input, db) {
  let v = { title: old.title, question: old.question, answer: old.answer, keywords: old.keywords };
  let hash = old.source_hash;
  let audience = old.audience;
  let status = 'draft';

  if (input.action === 'refresh') {
    const doc = await sourceDocument(db, old.source_kind, old.source_id);
    if (!doc) fail(404, '来源已失效');
    v = values(doc);
    hash = await digest(doc);
    audience = doc.audience;
  } else if (input.action === 'publish') {
    if (input.confirm_review !== true) fail(400, '请先确认内容、隐私和适用范围已核对');
    // 来源已经变了还发布，等于把过期规则重新放回客服口径
    if (!(await fresh(db, old))) fail(409, '来源已变化，请重新同步并审核');
    status = 'published';
  } else if (input.action === 'retract') {
    status = 'retracted';
  } else {
    v = values({ ...old, ...input });
    audience = input.audience || old.audience;
    if (!AUDIENCES.includes(audience)) fail(400, '适用范围无效');
    // 题库来源一旦流进公开客服口径，玩家会拿题库条款当交规
    if (old.source_kind === 'exam' && audience !== 'exam') fail(400, '题库来源不能改为公开客服资料');
  }
  return { v, hash, audience, status };
}

export const onRequestPatch = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'super');
    const input = await body(c.request);
    const db = c.env.DB;
    const id = integer(new URL(c.request.url).searchParams.get('id'));
    const revision = integer(input.revision);

    const old = await db.prepare('SELECT * FROM knowledge_articles WHERE id=?').bind(id).first();
    if (!old) fail(404, '知识条目不存在');
    if (old.revision !== revision) fail(409, '资料已被修改，请刷新再审核');

    const { v, hash, audience, status } = await reviewTarget(old, input, db);

    const result = await db.batch([
      db
        .prepare(
          "UPDATE knowledge_articles SET title=?,question=?,answer=?,keywords=?,audience=?,status=?,source_hash=?,reviewed_by=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?"
        )
        .bind(v.title, v.question, v.answer, v.keywords, audience, status, hash, status === 'published' ? admin.id : null, id, revision),
      db
        .prepare('INSERT INTO knowledge_versions(article_id,revision,payload,actor_id,actor_name,action) SELECT ?,?,?,?,?,? WHERE changes()=1')
        .bind(id, revision + 1, JSON.stringify({ ...v, audience, status, source_hash: hash }), admin.id, admin.username, input.action || 'edited'),
      db
        .prepare(
          "INSERT INTO audit_events(actor_type,actor_id,actor_name,action,resource_type,resource_id,http_status,details) SELECT 'admin',?,?,?,'knowledge_articles',?,200,? WHERE changes()=1"
        )
        .bind(admin.id, admin.username, 'knowledge.' + (input.action || 'edited'), String(id), JSON.stringify({ from: old.status, to: status, revision: revision + 1 })),
    ]);

    if (!result[0].meta.changes) fail(409, '资料已被修改，请刷新');
    return reply({ id, status, revision: revision + 1 });
  });

