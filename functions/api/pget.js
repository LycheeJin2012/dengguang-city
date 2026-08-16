// 极简测试 - 看是不是文件本身的问题
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, test: 'pinfo works' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
