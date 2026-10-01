/**
 * 账户安全里的通行密钥（passkey / WebAuthn）三条链路。
 *
 * 三个函数是同一套流程的三个入口，差别只在第几步和问哪个端点：
 *   passkeyLogin    登录         start → credentials.get  → finish
 *   registerPasskey 注册新通行密钥 start → credentials.create → finish
 *   testPasskey     试一下已有的   start → credentials.get  → finish
 *
 * 每条链路的中间产物 publicKey 里的 challenge / credential.id 都是 **base64url**
 * 字符串，进 WebAuthn API 前要 decode 回原始字节（decode），出去时要 encode
 * （encode）。这两个是安全路径，不要顺手改 —— tests/feedback-security-equiv.test.js
 * 拿真实字节做两版实跑比对。
 */

import {post} from './core.js';

/** base64url → ArrayBuffer。- 换回 +、_ 换回 /，atob 自己会补 = 填充。 */
const decode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer;

/** ArrayBuffer → base64url。+ 换 -、/ 换 _、去掉结尾的 = 填充。 */
const encode = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 玩家或管理员登录。target 决定走哪一对端点，但请求体里原样透传。 */
export async function passkeyLogin(target = 'player') {
  if (!navigator.credentials || !window.PublicKeyCredential) throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
  const d = await post('/api/init?action=' + (target === 'admin' ? 'passkey-admin-start' : 'passkey-login-start'));
  const opts = d.publicKey;
  opts.challenge = decode(opts.challenge);
  if (opts.allowCredentials) {
    opts.allowCredentials = opts.allowCredentials.map(c => ({
      ...c,
      id: decode(c.id),
    }));
  }
  const cred = await navigator.credentials.get({
    publicKey: opts,
  });
  if (!cred) throw new Error('没验完就退出了，重来一次');
  await post('/api/init?action=' + (target === 'admin' ? 'passkey-admin-finish' : 'passkey-login-finish'), {
    challenge_token: d.challenge_token,
    target,
    credential: {
      id: cred.id,
      rawId: encode(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: encode(cred.response.clientDataJSON),
        authenticatorData: encode(cred.response.authenticatorData),
        signature: encode(cred.response.signature),
        userHandle: cred.response.userHandle ? encode(cred.response.userHandle) : null,
      },
    },
  });
}

/** 给当前账号加一个新的通行密钥。name 是给用户看的那条通行密钥名。 */
export async function registerPasskey(name) {
  if (!navigator.credentials || !window.PublicKeyCredential) throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
  const d = await post('/api/init?action=passkey-register-start');
  const opts = d.publicKey;
  opts.challenge = decode(opts.challenge);
  opts.user.id = decode(opts.user.id);
  // excludeCredentials 告诉浏览器「这台设备上已经有的就别再问一次」，没有就跳过。
  if (opts.excludeCredentials) {
    opts.excludeCredentials = opts.excludeCredentials.map(c => ({
      ...c,
      id: decode(c.id),
    }));
  }
  const cred = await navigator.credentials.create({
    publicKey: opts,
  });
  if (!cred) throw new Error('没验完就退出了，重来一次');
  await post('/api/init?action=passkey-register-finish', {
    name,
    challenge_token: d.challenge_token,
    credential: {
      id: cred.id,
      rawId: encode(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: encode(cred.response.clientDataJSON),
        attestationObject: encode(cred.response.attestationObject),
        // 老浏览器没有 getTransports，兜底空数组。
        transports: cred.response.getTransports?.() || [],
      },
    },
  });
}

/**
 * 拿某一条已登记的通行密钥试一下能不能验过。
 *
 * 和上面两个函数的差别有三个，都钉在测试里：
 *   · 报错文案不一样（这里是「设备没验成」，另两个是「没验完就退出了」）
 *   · allowCredentials 直接 .map，没加 if 保护 —— 端点必定下发这个字段
 *   · 结尾是 return 而不是 await，返回值要透给调用方（pages/profile/security.js 用它判成功）
 */
export async function testPasskey(id) {
  if (!navigator.credentials || !window.PublicKeyCredential) throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
  const d = await post('/api/init?action=passkey-test-start', {id});
  const opts = d.publicKey;
  opts.challenge = decode(opts.challenge);
  opts.allowCredentials = opts.allowCredentials.map(c => ({
    ...c,
    id: decode(c.id),
  }));
  let cred;
  try {
    cred = await navigator.credentials.get({publicKey: opts});
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('你取消了，或者等超时了，再点一次就行');
    throw e;
  }
  if (!cred) throw new Error('设备没验成，重来一次');
  return post('/api/init?action=passkey-test-finish', {
    challenge_token: d.challenge_token,
    credential: {
      id: cred.id,
      rawId: encode(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: encode(cred.response.clientDataJSON),
        authenticatorData: encode(cred.response.authenticatorData),
        signature: encode(cred.response.signature),
      },
    },
  });
}
