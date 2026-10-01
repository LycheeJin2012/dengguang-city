// 管理员市民账号动作: init.js 把所有 admin-player-* 动作都转到这里。
//
// 这里有一处**有意为之**的改写, 是整个文件唯一的行为:
//   action === 'admin-player-list' 时, 把 request 换成 new Request(url, { headers })。
//   因为没传 method, 新 Request 的 method 掉回 GET, 于是 players() 走它的 GET
//   列表分支 —— 老的 /api/init 用 POST 承载列表请求, 而列表是只读的。
// 任何**其它** admin-player-* 动作原样透传(保持 POST), 由 players() 自己判角色。
//
// v88.7 去压缩重写: 只把一句话拆成可读结构, **不要「顺手修」这个改写**。
// 去掉它, 普通管理员读列表会从 200 掉成 403。
// 证据见 tests/admin-actions-equiv.test.js(里面有一条拿 PATCH 当探针的反向用例)。
import { players } from '../../_core/accounts.js';

export const onRequestPost = (context) => {
  const action = new URL(context.request.url).searchParams.get('action');
  if (action !== 'admin-player-list') return players(context);
  // 只带 URL 与请求头: 不带 method(所以是 GET), 也不带 body。
  const asGetRequest = new Request(context.request.url, { headers: context.request.headers });
  return players({ ...context, request: asGetRequest });
};
