// GET    /api/admin/messages              - 管理员看所有留言
// PATCH  /api/admin/messages?id=X         - 修改 status 或 admin_reply
// DELETE /api/admin/messages?id=X         - 删除留言
import { ok, err, readToken, getSession, stripHtml, isNonEmpty } from '../../_shared.js';

async function requireAdmin(context) {
  const { env, request } = context;
  const token = readToken(request);
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return null;
  const admin = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!admin) return null;
  return admin;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  let rows;
  if (status) {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id WHERE m.status = ? ORDER BY m.created_at DESC'
    ).bind(status).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT m.*, p.username as player_username FROM messages m LEFT JOIN players p ON p.id = m.player_id ORDER BY m.created_at DESC LIMIT 200'
    ).all();
  }
  return ok({ messages: rows.results });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');

  let body = {};
  try { body = await request.json(); } catch (e) { /* no body */ }

  const status = url.searchParams.get('status');
  const reply  = body.admin_reply;

  // 改 status
  if (status && ['new', 'read', 'done'].includes(status)) {
    await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?').bind(status, id).run();
  }
  // 改 admin_reply（v16：支持 admin 回复玩家留言）
  if (typeof reply === 'string') {
    const cleaned = stripHtml(reply);
    if (cleaned.length > 0) {
      if (cleaned.length > 2000) return err(400, '回复内容不能超过 2000 字符');
      await env.DB.prepare(
        "UPDATE messages SET admin_reply = ?, replied_at = datetime('now'), replied_by = ? WHERE id = ?"
      ).bind(cleaned, admin.id, id).run();
    } else {
      // 空字符串 = 清除回复
      await env.DB.prepare(
        'UPDATE messages SET admin_reply = NULL, replied_at = NULL, replied_by = NULL WHERE id = ?'
      ).bind(id).run();
    }
  }
  if (!status && typeof reply !== 'string') return err(400, '无更新字段');
  return ok({ id });
}

export async function onRequestPost(context) {
  // 内部子路由：POST /api/admin/messages?action=ai-draft
  // body: { message: string, history?: [{role, content}] }
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (action !== 'ai-draft') return err(400, '未知 action');

  // OpenAI 兼容配置（用户在 CF Pages Dashboard 环境变量里设置）
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    return err(500, 'AI 未配置：管理员需在 Cloudflare Pages → Settings → Environment variables 设置 OPENAI_API_KEY');
  }

  const body = await request.json().catch(() => ({}));
  const userMessage = (body.message || '').toString().trim();
  if (!userMessage) return err(400, '缺少留言内容');
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

  const systemPrompt = `你是「灯光市」市政厅（Light City Hall）的官方助手。灯光市是一座 Minecraft 服务器上的像素城市，由玩家共同管理。

你的任务：根据市民的留言内容，草拟一份**市政厅的回复草稿**，供管理员参考与修改。

要求：
1. 语气：亲切、正式、礼貌，像一名友善的市政官员
2. 必须先**承认/回应**市民的诉求或留言
3. 给出**清晰下一步**（例如："我们会在 3 个工作日内审核"、"请补充联系方式"、"感谢建议，已记录"）
4. 长度：80-200 字之间，不要太长
5. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名称、日期、文件路径等都不准出现
6. 不知道/不确定的事情，引导走其他渠道（"请用 DM 私信我们"、"请在留言里留下联系方式"）
7. 不要使用"草稿："或"回复："这类前缀，直接写正文
8. 不要使用 markdown 标题/列表，纯文本段落即可`;

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
    }
  }
  messages.push({ role: 'user', content: userMessage.slice(0, 4000) });

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return err(502, `AI 调用失败 ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json().catch(() => ({}));
    const draft = (data?.choices?.[0]?.message?.content || '').trim();
    if (!draft) return err(502, 'AI 返回为空');

    return ok({ draft, model });
  } catch (e) {
    return err(500, 'AI 调用异常: ' + (e?.message || e));
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const admin = await requireAdmin(context);
  if (!admin) return err(401, '需要管理员登录');

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id') || '0', 10);
  if (!id) return err(400, 'id 必填');
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return ok({ deleted: id });
}
