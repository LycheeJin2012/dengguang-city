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
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
  const model = env.OPENAI_MODEL || 'abab6.5s-chat';
  if (!apiKey) {
    return err(500, 'AI 未配置：管理员需在 Cloudflare Pages → Settings → Environment variables 设置 OPENAI_API_KEY');
  }

  const body = await request.json().catch(() => ({}));
  const userMessage = (body.message || '').toString().trim();
  if (!userMessage) return err(400, '缺少留言内容');
  if (userMessage.length > 100) return err(400, '留言内容不能超过 100 字');
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const tone = (body.tone || 'standard').toString().toLowerCase();

  // 四种 tone: standard | professional | concise | detailed
  let systemPrompt;
  let maxTokens = 200;
  let hardCap = 100;
  if (tone === 'professional') {
    systemPrompt = `你是「灯光市」市政厅的资深公文秘书。灯光市是一座 Minecraft 服务器上的像素城市。

任务：针对市民留言，起草一份**专业、正式、可直接发布**的市政厅回函草稿。

写作要求（政府公文体）：
1. 称呼：开头用"您好，感谢您的留言"或"您好，已收悉您的留言"
2. 主体：先精准回应诉求（不超过 1 句话复述对方要点），再给出**清晰可执行的下一步**（如"我厅将在近期内组织核实并回复"、"已转交相关部门研处"、"建议您通过 DM 私信补充具体信息"）
3. 结尾：礼貌收束，如"感谢您对灯光市建设的关注与支持"、"如有疑问请随时联系市政厅"
4. 正式、客观、严谨，**不夸大不敷衍**
5. **总字数严格控制在 100 字以内**（含标点和称呼、结尾）
6. 严禁编造：具体数字、人名、电话、邮箱、活动名、具体日期、文件名都不准出现
7. 不确定的事请用"我厅将组织研处"或"将由相关负责同志与您联系"
8. 不要前缀"回复："或"草稿："，纯文本，不要 markdown`;
  } else if (tone === 'concise') {
    systemPrompt = `你是灯光市 AI 客服灯灯。任务：用最短的话回应市民留言。**30 字以内**（含标点）。先回应再给下一步。无具体数字人名。直接正文。`;
  } else if (tone === 'detailed') {
    maxTokens = 900;
    hardCap = 600;
    systemPrompt = `你是「灯光市」市政厅（Light City Hall）的资深公文秘书，专门处理需要**详细说明**的市民留言回复。灯光市是一座 Minecraft 服务器上的像素城市。

任务：起草一份**结构清晰、内容详实、逻辑完整**的市政厅回函草稿，供管理员参考与修改。

【结构要求 - 严格 5 段】
1. 【致谢】开头用 "您好，感谢您的留言。" 表达对市民反馈的感谢
2. 【说明】精准复述市民的核心诉求（1-2 句话），让对方感觉被倾听
3. 【措施】明确说明市政厅已经或将采取的具体措施（1-3 句话），用 "已 / 将 / 正在 / 计划" 等时态清楚的动词
4. 【承诺】给出可期待的时间或反馈方式（"近期 / 后续 / 在 X 时段内 / 通过 DM 私信"等），让对方知道下一步
5. 【结尾】礼貌收束，如 "感谢您对灯光市建设的关注与支持。灯光市市政厅。" 或 "如有疑问请随时通过 DM 联系我们。"

【写作要求】
- 正式、严谨、客观，**不夸大不敷衍**
- **总字数 300-500 字**（含标点），结构化分段，每段用换行分隔
- 严禁编造任何具体信息：具体数字、人名、电话、邮箱、活动名、具体日期、文件名都不准出现
- 不确定的事用 "市政厅将组织研处"、"将由相关负责同志与您联系"、"建议您通过 DM 私信补充具体信息" 等
- 不要前缀 "回复："、"草稿：" 等；直接正文；用换行分段
- 纯文本，不要 markdown 格式（不要加粗、不要列表符号）`;
  } else {
    systemPrompt = `你是「灯光市」市政厅（Light City Hall）的官方助手。灯光市是一座 Minecraft 服务器上的像素城市，由玩家共同管理。

你的任务：根据市民的留言内容，草拟一份**市政厅的回复草稿**，供管理员参考与修改。

严格要求：
1. 语气：亲切、正式、礼貌
2. 先承认回应，再给下一步
3. **总字数必须控制在 100 字以内**（含标点）。宁可少写，不要超
4. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等不准出现
5. 不确定的事引导走其他渠道
6. 不要前缀（"草稿："等），直接正文
7. 纯文本，不要 markdown 格式`;
  }

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 200) });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return err(502, `AI 调用失败 ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json().catch(() => ({}));
    let draft = (data?.choices?.[0]?.message?.content || '').trim();
    if (!draft) return err(502, 'AI 返回为空');
    // 硬截断（兜底）- 详细 tone 上限更高
    if (draft.length > hardCap) draft = draft.slice(0, hardCap);

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
