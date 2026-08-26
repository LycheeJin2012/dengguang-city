// v27: 驾照考试要求管理独立端点 (替换 manage-data.js 的 keys=licenseReq)
// GET /api/admin/manage-license-req → {ok:true, items:[...]}
import { err } from '../../_shared.js';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return err('D1 not configured', 500);
  try {
    const r = await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all();
    return new Response(JSON.stringify({
      ok: true,
      items: r.results || [],
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return err('SQL 失败: ' + (e.message || e), 500);
  }
}
