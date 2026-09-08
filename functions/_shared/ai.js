// v45 重写: AI 自动回复 (OpenAI 兼容 + 离线兜底) + 灯灯 system 玩家
// 从 _shared.js L183-307 拆出
import { hashPassword } from './auth.js';

// 离线兜底回复（key 未设时用，关键词匹配，绝不返回 null）
// 模板里不出现具体数字/人名/电话/活动，全部诚实留白
function offlineReply(text, context) {
  if (/谢谢|感谢|thanks/i.test(text)) return '不客气，欢迎继续关注灯光市。';
  return context === 'dm'
    ? '你好，我是自动客服灯灯。目前无法自动回答这个问题。你可以在首页留言板说明情况，或等待市政厅人工回复。'
    : '您好，感谢您反馈。请补充相关情况，供市政厅核实。此条为自动建议，具体处理结果以管理员回复为准。';
}

// AI 自动回复助手（OpenAI 兼容 chat completions）
// 未配置 OPENAI_API_KEY 时走离线兜底（保证体验不中断）
export async function aiAutoReply(env, userMessage, context = 'message') {
  const text = String(userMessage || '').trim().slice(0, 100);
  if (!text) return null;
  if (!env || !env.OPENAI_API_KEY) {
    return offlineReply(text, context);
  }
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';

  const sys = context === 'dm'
    ? `你是「灯光市 AI 客服」灯灯。灯光市是一座 Minecraft 服务器上的像素城市。

服务市民，解答问题、指引流程、收建议。
要求：
1. 亲切、简洁、像邻家小助手
2. **总字数必须控制在 100 字以内**（含标点）
3. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
4. 不确定的事请说"请联系市政厅人工客服"
5. 不要前缀（"灯灯："等），直接正文
6. 纯文本，不要 markdown 格式`
    : `你是「灯光市」市政厅 AI 助手。灯光市是一座 Minecraft 服务器上的像素城市。

任务是给市民留言写一封**市政厅回复**。
要求：
1. 亲切、正式、礼貌
2. 先承认回应，再给下一步
3. **总字数必须控制在 100 字以内**（含标点）
4. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
5. 不确定的事引导走 DM 私信或加备注
6. 不要前缀（"市政厅："等），直接正文
7. 纯文本，不要 markdown 格式`;

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });
    if (!resp.ok) return offlineReply(text, context);
    const data = await resp.json().catch(() => ({}));
    let draft = (data?.choices?.[0]?.message?.content || '').trim();
    if (!draft) return offlineReply(text, context);
    if (draft.length > 100) draft = draft.slice(0, 100);
    return draft;
  } catch (e) {
    return offlineReply(text, context);
  }
}

// 获取/创建 AI 客服 system 玩家（username = '灯灯客服'）
export async function getOrCreateAiBot(env) {
  const fixedUsername = '灯灯客服';
  let row = await env.DB.prepare(
    "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
  ).bind(fixedUsername).first();
  if (row) return row;
  const randomPwd = crypto.getRandomValues(new Uint8Array(24)).toString() + Date.now();
  const { hash, salt } = await hashPassword(randomPwd, null);
  try {
    await env.DB.prepare(
      "INSERT INTO players (username, email, password_hash, salt, game_id, status, bio, avatar_emoji) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
    ).bind(
      fixedUsername, 'ai-bot@system.local', hash, salt, 'AI_BOT',
      '我是 AI 客服灯灯，由市政厅训练。', '🤖'
    ).run();
  } catch (e) {
    row = await env.DB.prepare(
      "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
    ).bind(fixedUsername).first();
    if (row) return row;
    throw e;
  }
  return await env.DB.prepare(
    "SELECT id, username, avatar_emoji FROM players WHERE username = ?"
  ).bind(fixedUsername).first();
}
