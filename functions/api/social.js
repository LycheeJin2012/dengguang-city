// v50: 社交关系 (关注 / 拉黑) — 简化版 stub
import { ok, err, handleOptions, getSession, readToken } from '../_shared.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const sess = await getSession(env, readToken(request));
  if (!sess?.player_id) return err(401, '请先登录');
  // v50: 社交关系 (后续可加 follows / blocks 表, 这里先返回空)
  return ok({ follows: [], blocks: [] });
}
