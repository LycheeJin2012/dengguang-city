// AI 草稿回复端点（管理员用）
// POST /api/ai/reply-draft
// body: { message: string, history?: [{role, content}] }
// 需要管理员登录（lc_session cookie + sessions.admin_id）

export async function onRequestPost({ request, env }) {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: cors });
  }

  try {
    // 1. 鉴权：必须是 admin
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/lc_session=([^;]+)/);
    if (!m) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: cors });
    }
    const token = m[1];
    const sess = await env.DB
      .prepare('SELECT admin_id, expires_at FROM sessions WHERE token = ?')
      .bind(token)
      .first();
    if (!sess || !sess.admin_id) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: cors });
    }
    if (Date.now() / 1000 > (sess.expires_at || 0)) {
      return new Response(JSON.stringify({ error: '会话已过期，请重新登录' }), { status: 401, headers: cors });
    }

    // 2. 读取配置（env vars，用户在 Cloudflare Pages Dashboard 设置）
    const apiKey = env.OPENAI_API_KEY;
    const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'AI 未配置：管理员需要在 Cloudflare Pages → Settings → Environment variables 设置 OPENAI_API_KEY',
      }), { status: 500, headers: cors });
    }

    // 3. 读取请求体
    const body = await request.json().catch(() => ({}));
    const userMessage = (body.message || '').toString().trim();
    if (!userMessage) {
      return new Response(JSON.stringify({ error: '缺少留言内容' }), { status: 400, headers: cors });
    }
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];

    // 4. 组装 prompt
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

    // 5. 调用 OpenAI 兼容 API
    const url = `${baseUrl}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return new Response(JSON.stringify({
        error: `AI 调用失败 ${resp.status}: ${errText.slice(0, 300)}`,
      }), { status: 502, headers: cors });
    }

    const data = await resp.json().catch(() => ({}));
    const draft = data?.choices?.[0]?.message?.content?.trim() || '';

    if (!draft) {
      return new Response(JSON.stringify({
        error: 'AI 返回为空',
      }), { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ draft, model }), {
      status: 200,
      headers: cors,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '异常: ' + (e?.message || e) }), {
      status: 500,
      headers: cors,
    });
  }
}

export async function onRequestOptions() {
  return new Response('', {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
