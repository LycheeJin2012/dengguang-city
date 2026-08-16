export async function onRequestGet() {
  return new Response(JSON.stringify({ hello: 'world' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
