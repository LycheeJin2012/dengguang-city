// GET /api/debug - 列出所有 env 变量名（debug 用）
export async function onRequestGet(context) {
  const { env } = context;
  const keys = Object.keys(env || {});
  const info = {
    env_keys: keys,
    has_DB: !!env.DB,
    DB_type: env.DB ? typeof env.DB : null,
    DB_constructor: env.DB ? env.DB.constructor.name : null,
    DB_keys: env.DB && typeof env.DB === 'object' ? Object.keys(env.DB) : null,
    raw_env_sample: keys.slice(0, 5).map(k => ({ k, type: typeof env[k] })),
  };
  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'content-type': 'application/json' }
  });
}
