// 诊断端点：POST /api/ai/test  →  admin 才能调
// 返回真实 AI 调用结果（包含错误细节），用来排查 key / url / model 配置

export async function onRequestPost({ request, env }) {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  // admin 鉴权
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/lc_session=([^;]+)/);
  if (!m) return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: cors });
  const sess = await env.DB
    .prepare('SELECT admin_id, expires_at FROM sessions WHERE token = ?')
    .bind(m[1]).first();
  if (!sess || !sess.admin_id) return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers: cors });
  if (Date.now() / 1000 > (sess.expires_at || 0)) return new Response(JSON.stringify({ error: '会话已过期' }), { status: 401, headers: cors });

  const body = await request.json().catch(() => ({}));
  const testMsg = (body.message || '你好').toString().slice(0, 100);
  const overrideBase = body.base_url;
  const overrideKey = body.api_key;
  const overrideModel = body.model;

  const apiKey = overrideKey || env.OPENAI_API_KEY;
  const baseUrl = (overrideBase || env.OPENAI_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, '');
  const model = overrideModel || env.OPENAI_MODEL || 'abab6.5s-chat';

  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false, stage: 'config',
      error: 'OPENAI_API_KEY 未配置',
      hint: '在 Cloudflare Pages → Settings → Environment variables 设置'
    }), { status: 500, headers: cors });
  }

  const url = `${baseUrl}/chat/completions`;
  const reqBody = {
    model,
    messages: [
      { role: 'system', content: '你是灯灯。请用一句话（30 字内）自我介绍。' },
      { role: 'user', content: testMsg },
    ],
    temperature: 0.5,
    max_tokens: 100,
  };

  let networkError = null;
  let respStatus = null;
  let respBody = null;
  let respText = '';
  const t0 = Date.now();

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
    });
    respStatus = resp.status;
    respText = await resp.text().catch(() => '');
    try { respBody = JSON.parse(respText); } catch (e) { /* not json */ }
  } catch (e) {
    networkError = e?.message || String(e);
  }

  const elapsed = Date.now() - t0;

  if (networkError) {
    return new Response(JSON.stringify({
      ok: false, stage: 'network',
      error: networkError,
      url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed,
    }), { status: 200, headers: cors });
  }

  if (respStatus !== 200) {
    return new Response(JSON.stringify({
      ok: false, stage: 'http',
      http_status: respStatus,
      url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed,
      raw: respText.slice(0, 500),
      parsed: respBody,
    }), { status: 200, headers: cors });
  }

  const draft = respBody?.choices?.[0]?.message?.content || '';
  return new Response(JSON.stringify({
    ok: true,
    url, model, key_prefix: apiKey.slice(0, 10) + '...', elapsed_ms: elapsed,
    draft,
    full: respBody,
  }), { status: 200, headers: cors });
}
