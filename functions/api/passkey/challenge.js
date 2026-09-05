// v50: 公开 alias — GET /api/passkey/challenge
// 前端 auth.js 用 GET 触发 passkey login 流程, 内部转 POST passkey-login-start
import { onRequestPost as passkeyPost } from '../actions/passkey.js';
import { ok, err } from '../../_shared.js';

export async function onRequestGet(context) {
  // GET 不带 username → usernameless 模式
  // 直接复用 passkeyPost, 但传空 body
  const { request } = context;
  // 构造一个空 JSON body 模拟 POST
  const newRequest = new Request(request.url, {
    method: 'POST',
    headers: { ...Object.fromEntries(request.headers), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const newContext = { ...context, request: newRequest };
  return passkeyPost(newContext);
}
