import { auditStatement } from '../../_core/audit.js';
import { endpoint, identity, body, string, integer, reply, fail } from '../../_core/request.js';
import { aiDraft, getOrCreateAiBot } from '../../_shared/ai.js';

export const onRequestPost = (c) =>
  endpoint(async () => {
    const admin = await identity(c, 'super');
    const input = await body(c.request);
    const action = new URL(c.request.url).searchParams.get('action');
    const db = c.env.DB;

    switch (action) {
      // 会话列表：按「两人对」分组，每人只留最新一条做预览
      case 'admin-dm-conversations': {
        const q = string(input.q ?? '', '搜索', 100, { required: false });
        const rows = await db
          .prepare(
            `WITH ranked AS(SELECT d.*,ROW_NUMBER() OVER(PARTITION BY MIN(from_player_id,to_player_id),MAX(from_player_id,to_player_id) ORDER BY id DESC) AS rn FROM direct_messages d) SELECT r.from_player_id,r.to_player_id,r.content AS last_content,r.created_at AS last_at,p.username AS from_username,p2.username AS to_username FROM ranked r JOIN players p ON p.id=r.from_player_id JOIN players p2 ON p2.id=r.to_player_id WHERE rn=1 AND (?='' OR p.username LIKE ? OR p2.username LIKE ?) ORDER BY r.id DESC LIMIT 200`
          )
          .bind(q, '%' + q + '%', '%' + q + '%')
          .all();
        return reply({ conversations: rows.results });
      }

      // 单个会话的完整消息：先取最近 200 条再翻回正序
      case 'admin-dm-thread': {
        const from = integer(input.from_player_id);
        const to = integer(input.to_player_id);
        const rows = await db
          .prepare(
            'SELECT * FROM (SELECT * FROM direct_messages WHERE (from_player_id=? AND to_player_id=?) OR (from_player_id=? AND to_player_id=?) ORDER BY id DESC LIMIT 200) ORDER BY id'
          )
          .bind(from, to, to, from)
          .all();
        return reply({ messages: rows.results });
      }

      case 'admin-dm-reply': {
        const to = integer(input.to_player_id);
        const content = string(input.content, '回复', 2000);
        // 客服身份必须存在才能以「灯灯客服」的名义发；先建号再做收件人校验
        const bot = await getOrCreateAiBot(c.env);
        if (!(await db.prepare("SELECT id FROM players WHERE id=? AND status='active'").bind(to).first())) {
          fail(404, '收件人不存在');
        }
        const results = await db.batch([
          db
            .prepare('INSERT INTO direct_messages(from_player_id,to_player_id,content,replied_by_admin_id) VALUES(?,?,?,?)')
            .bind(bot.id, to, content, admin.id),
          db
            .prepare("INSERT INTO notification_log(player_id,type,title,body,link) VALUES(?,'dm','市政客服回复',?,'/dm.html')")
            .bind(to, content),
        ]);
        return reply({ id: results[0].meta.last_row_id }, 201);
      }

      case 'admin-dm-ai-suggest': {
        const content = string(input.content || input.context || '', '上下文', 4000, { required: false });
        const instructions = string(input.instructions || '', '补充要求', 1000, { required: false });
        const existing = string(input.existing || '', '已有文字', 2000, { required: false });
        const mode = input.mode || 'reply';
        if (!['reply', 'rewrite', 'summary'].includes(mode)) fail(400, '草稿类型无效');
        if (mode === 'rewrite' && !existing) fail(400, '请先填写要修改的文字');

        const result = await aiDraft(c.env, { message: content, instructions, existing, mode });
        // 草稿一律 sent:false：模型只出文本，真正发出必须走 admin-dm-reply
        await auditStatement(
          c.audit?.base || db,
          { type: 'admin', id: admin.id, name: admin.username },
          {
            action: 'ai.draft_created',
            resource_type: 'direct_messages',
            status: 200,
            details: { mode, instructions, source: result.source, sent: false },
          }
        ).run();
        return reply(result);
      }

      // 机器人答不下去的信号：玩家说了「人工」「稍后」，客服就该接手
      case 'admin-dm-ai-struggle': {
        const bot = await getOrCreateAiBot(c.env);
        const rows = await db
          .prepare(
            "SELECT * FROM direct_messages WHERE from_player_id=? AND (content LIKE '%人工%' OR content LIKE '%稍后%') ORDER BY id DESC LIMIT 100"
          )
          .bind(bot.id)
          .all();
        return reply({ struggles: rows.results });
      }

      case 'admin-dm-list': {
        const rows = await db.prepare('SELECT * FROM direct_messages ORDER BY id DESC LIMIT 200').all();
        return reply({ dms: rows.results });
      }
    }

    fail(404, '未知私信管理操作');
  });
