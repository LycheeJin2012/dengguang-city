// v45 重写: 管理员 DM 监管 action 群 (6 个, super only)
// 从 init.js LEGACY 段 L249-392 拆出
import { ok, err, parseSession } from '../_helpers.js';
import { aiAutoReply } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  const { sess: _sess, me: _me } = await parseSession(env, request);
  if (!_sess || !_sess.admin_id) return err(401, '需要管理员登录');
  if (!_me || _me.role !== 'super') return err(403, '仅 super 管理员可使用此功能');

  try {
    if (action === 'admin-dm-conversations') {
      const _body = await request.json().catch(() => ({}));
      const _q = (_body.q || '').trim();
      // v43.2: CTE + 窗口函数 取每对最新消息 + 聚合未读数
      const _sql = `
        WITH ranked AS (
          SELECT dm.*, ROW_NUMBER() OVER (
            PARTITION BY
              CASE WHEN dm.from_player_id < dm.to_player_id THEN dm.from_player_id ELSE dm.to_player_id END,
              CASE WHEN dm.from_player_id > dm.to_player_id THEN dm.from_player_id ELSE dm.to_player_id END
            ORDER BY dm.id DESC
          ) AS rn
          FROM direct_messages dm
        ),
        unread AS (
          SELECT
            CASE WHEN from_player_id < to_player_id THEN from_player_id ELSE to_player_id END AS p1,
            CASE WHEN from_player_id > to_player_id THEN from_player_id ELSE to_player_id END AS p2,
            COUNT(*) AS unread_count
          FROM direct_messages
          WHERE read_at IS NULL
          GROUP BY p1, p2
        )
        SELECT
          r.from_player_id, r.to_player_id, r.content AS last_content, r.created_at AS last_at, r.read_at,
          r.replied_by_admin_id, ad.username AS replied_by_admin_username,
          pf.username AS from_username, pt.username AS to_username,
          pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar,
          COALESCE(u.unread_count, 0) AS unread_count
        FROM ranked r
        LEFT JOIN players pf ON pf.id = r.from_player_id
        LEFT JOIN players pt ON pt.id = r.to_player_id
        LEFT JOIN admins ad ON ad.id = r.replied_by_admin_id
        LEFT JOIN unread u
          ON u.p1 = CASE WHEN r.from_player_id < r.to_player_id THEN r.from_player_id ELSE r.to_player_id END
         AND u.p2 = CASE WHEN r.from_player_id > r.to_player_id THEN r.from_player_id ELSE r.to_player_id END
        WHERE r.rn = 1
      `;
      let _finalSql = _sql;
      const _params = [];
      if (_q) {
        _finalSql += ` AND (pf.username LIKE ? OR pt.username LIKE ? OR r.content LIKE ?)`;
        const _like = `%${_q}%`;
        _params.push(_like, _like, _like);
      }
      _finalSql += ` ORDER BY r.created_at DESC LIMIT 100`;
      const _rows = await env.DB.prepare(_finalSql).bind(..._params).all();
      return ok({ conversations: _rows.results || [] });
    }
    if (action === 'admin-dm-ai-suggest') {
      const _body = await request.json().catch(() => ({}));
      const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
      const _lastMsg = (_body.last_message || '').toString().slice(0, 200);
      if (!_toPlayerId) return err(400, 'to_player_id 必填');
      if (!_lastMsg) return err(400, 'last_message 必填');
      const _ctx = await env.DB.prepare(`
        SELECT dm.from_player_id, dm.content, dm.created_at
        FROM direct_messages dm
        WHERE (dm.from_player_id = ? AND dm.to_player_id = 17)
           OR (dm.from_player_id = 17 AND dm.to_player_id = ?)
        ORDER BY dm.id DESC LIMIT 5
      `).bind(_toPlayerId, _toPlayerId).all();
      const _ctxStr = (_ctx.results || []).reverse().map(m =>
        `${m.from_player_id === 17 ? '灯灯' : '玩家'}: ${m.content}`
      ).join('\n');
      const _draft = await aiAutoReply(_lastMsg, _ctxStr);
      return ok({ draft: _draft, context: _ctxStr });
    }
    if (action === 'admin-dm-list') {
      const _body = await request.json().catch(() => ({}));
      const _q = (_body.q || '').trim();
      let _sql = `
        SELECT dm.id, dm.from_player_id, dm.to_player_id, dm.content, dm.created_at, dm.read_at,
               pf.username AS from_username, pt.username AS to_username,
               pf.avatar_emoji AS from_avatar, pt.avatar_emoji AS to_avatar
        FROM direct_messages dm
        LEFT JOIN players pf ON pf.id = dm.from_player_id
        LEFT JOIN players pt ON pt.id = dm.to_player_id
        WHERE 1=1
      `;
      const _params = [];
      if (_q) {
        _sql += ` AND (pf.username LIKE ? OR pt.username LIKE ? OR dm.content LIKE ?)`;
        const _like = `%${_q}%`;
        _params.push(_like, _like, _like);
      }
      _sql += ` ORDER BY dm.created_at DESC LIMIT 200`;
      const _rows = await env.DB.prepare(_sql).bind(..._params).all();
      return ok({ dms: _rows.results || [] });
    }
    if (action === 'admin-dm-thread') {
      const _pid1 = parseInt(url.searchParams.get('player_id') || '0', 10);
      const _pid2 = parseInt(url.searchParams.get('peer_id') || '0', 10);
      if (!_pid1 || !_pid2) return err(400, 'player_id 和 peer_id 必填');
      const _rows = await env.DB.prepare(`
        SELECT dm.*, pf.username AS from_username, pt.username AS to_username, pf.avatar_emoji AS from_avatar
        FROM direct_messages dm
        LEFT JOIN players pf ON pf.id = dm.from_player_id
        LEFT JOIN players pt ON pt.id = dm.to_player_id
        WHERE (dm.from_player_id = ? AND dm.to_player_id = ?)
           OR (dm.from_player_id = ? AND dm.to_player_id = ?)
        ORDER BY dm.created_at ASC LIMIT 200
      `).bind(_pid1, _pid2, _pid2, _pid1).all();
      return ok({ messages: _rows.results || [] });
    }
    if (action === 'admin-dm-reply') {
      const _body = await request.json().catch(() => ({}));
      const _toPlayerId = parseInt(_body.to_player_id || 0, 10);
      const _content = (_body.content || '').toString().trim().slice(0, 1000);
      if (!_toPlayerId) return err(400, 'to_player_id 必填');
      if (!_content) return err(400, 'content 不能为空');
      const _tp = await env.DB.prepare('SELECT id, username, status FROM players WHERE id = ?').bind(_toPlayerId).first();
      if (!_tp || _tp.status !== 'active') return err(404, '玩家不存在或已禁用');
      // 找灯灯机器人 (admin id = 17) 作为发送方
      const _bot = await env.DB.prepare("SELECT id FROM admins WHERE username = '灯灯客服' OR id = 17").first();
      if (!_bot) return err(500, '灯灯机器人未配置');
      const _ins = await env.DB.prepare(
        "INSERT INTO direct_messages (from_player_id, to_player_id, content, replied_by_admin_id) VALUES (?, ?, ?, ?)"
      ).bind(_bot.id, _toPlayerId, _content, _me.id).run();
      return ok({ id: _ins.meta.last_row_id, sent: true });
    }
    if (action === 'admin-dm-ai-struggle') {
      // 找 AI 兜底 / 转人工的对话
      const _rows = await env.DB.prepare(`
        SELECT id, from_player_id, to_player_id, content, created_at
        FROM direct_messages
        WHERE (content LIKE '%我作为 AI 给不出具体流程%'
           OR content LIKE '%我 AI 给不出%')
          AND created_at > datetime('now', '-1 day')
      `).all();
      return ok({ struggles: _rows.results || [] });
    }
    return err(404, '未知 admin-dm action: ' + action);
  } catch (e) {
    return err(500, 'admin-dm 错误: ' + (e?.message || String(e)));
  }
}
