import { fail } from './request.js';

/**
 * 调一次 Chat Completions，把回复解析成 JSON 对象。
 *
 * 刻意把「网络失败 / 非 2xx / 输出超长 / JSON 非法」全压成同一个 502：
 * 这些都是上游实现细节，原样抛给玩家既没意义，也会暴露模型供应商。
 */
export async function modelJson(env, system, input) {
  if (!env.OPENAI_API_KEY) {
    fail(503, '尚未配置 AI 模型服务；知识库检索可用，生成题目需要配置模型后再试');
  }

  try {
    const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const response = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 3500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });

    if (!response.ok) throw new Error('model unavailable');

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;

    // 长度上限必须在 JSON.parse 之前判断，否则会拿一个超长字符串去解析
    if (typeof text !== 'string' || text.length > 20000) throw new Error('bad model output');

    // 模型经常把 JSON 包在 ```json 围栏里，剥掉围栏再解析
    return JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch {
    fail(502, 'AI 暂不可用或返回了无效题目，未保存草稿，请重试');
  }
}
