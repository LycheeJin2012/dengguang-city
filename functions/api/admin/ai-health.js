import { endpoint, identity, reply, fail } from '../../_core/request.js';
import { stripModelNoise } from '../../_core/model-json.js';

/**
 * 模型服务健康检查（仅超管）。
 *
 * 为什么需要这个面板：全站 5 个模型调用点（灯灯草稿、模拟出题、工单分类、
 * 派单建议、自动回复）在上游出问题时**全都是静默降级** —— 页面照常可用，
 * 管理员拿到的却是固定模板，而且没有任何地方告诉他「AI 其实没在工作」。
 *
 * 这里做两件事：
 *   GET  只读回显配置，不发任何上游请求（key 本身永不返回，也不返回任何片段）
 *   POST 真的发一次最小请求，把 HTTP 状态、耗时和上游原话带回来
 *
 * POST 刻意复用 model-json.js 的参数形状（temperature + max_tokens）：
 * 换成别的形状就测不出「推理模型拒参数」这类静默降级，那正是最需要暴露的问题。
 */

/** 默认值回显，让超管不查 Cloudflare 也能确认当前生效的是哪一套。 */
const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * base_url 要回显，但可能带 user:pass@ 这种内嵌凭据
 * （部分中转服务把 key 放在 URL 里）。显示前剥掉。
 */
function safeBase(url) {
  if (!url) return DEFAULT_BASE;
  return String(url).replace(/\/\/[^/@]*@/, '//');
}

export const onRequestGet = (c) =>
  endpoint(async () => {
    await identity(c, 'super');
    return reply({
      configured: !!c.env.OPENAI_API_KEY,
      base_url: safeBase(c.env.OPENAI_BASE_URL),
      model: c.env.OPENAI_MODEL || DEFAULT_MODEL,
      // 明确声明：这个接口永远不会回传密钥，前端也别试着找
      key_exposed: false,
    });
  });

export const onRequestPost = (c) =>
  endpoint(async () => {
    await identity(c, 'super');

    if (!c.env.OPENAI_API_KEY) fail(400, '尚未配置模型密钥，无法进行连通性测试');

    const base = (c.env.OPENAI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
    const model = c.env.OPENAI_MODEL || DEFAULT_MODEL;
    const started = Date.now();

    // 超时比线上那些调用点更短：这是交互操作，用户在等。
    // 线上是 4~12s，这里 10s 足够覆盖正常波动，又不至于让人以为卡死。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    let response;
    let networkError = null;
    try {
      response = await fetch(base + '/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.env.OPENAI_API_KEY },
        body: JSON.stringify({
          model,
          temperature: 0,
          // 必须留出推理空间。实测 MiniMax-M3.1-Flash-Preview 出一道最简单的灯谜
          // 花了 211 个 completion token，其中 182 个是 reasoning —— 给 16 的话预算
          // 全被思考吃掉，一个字正文都吐不出来，还会随机挂到超时，让超管误判为未接通。
          max_tokens: 1024,
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
        }),
      });
    } catch (e) {
      networkError = e?.name === 'AbortError' ? '请求超时（10 秒无响应）' : '无法连接到模型服务：' + (e?.message || '未知错误');
    } finally {
      clearTimeout(timer);
    }

    const ms = Date.now() - started;

    if (networkError) return reply({ ok: false, status: 0, ms, model, base_url: safeBase(base), error: networkError });

    // 上游失败时把它的原话带回来（截断）。这是排查静默降级的唯一线索，
    // 但必须限长，且不能把 key 之类的东西带出去 —— 上游回显的是错误信息，不是凭据。
    let detail = '';
    if (!response.ok) {
      try {
        const raw = await response.text();
        const parsed = JSON.parse(raw);
        detail = String(parsed?.error?.message || parsed?.message || raw || '').slice(0, 300);
      } catch {
        detail = '';
      }
    }

    let sample = '';
    if (response.ok) {
      try {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        // 回声是给超管看的，剥掉推理模型的思考块，只留它真正回答的那句
        sample = typeof text === 'string' ? stripModelNoise(text).slice(0, 60) : '';
      } catch {
        sample = '';
      }
    }

    return reply({
      ok: response.ok,
      status: response.status,
      ms,
      model,
      base_url: safeBase(base),
      sample,
      error: response.ok ? '' : detail || `上游返回 HTTP ${response.status}`,
    });
  });