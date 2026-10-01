// 守门：ticketOwner 的「回避校验失败」必须真的回 403，不能被自己的 catch 吃掉。
//
// ── 缺陷 ────────────────────────────────────────────────────────────────
// functions/_core/uploads.js 的 ticketOwner() 原来长这样：
//
//   try {
//     const admin = await identity(c, 'admin');
//     if (回避条件) fail(403, '被投诉人不能处理该工单');
//     if (非超管且涉及投诉) fail(403, '此投诉仅限超管处理');
//   } catch (e) {
//     if (e.status !== 401 && e.status !== 403) throw e;   // ← 403 也被接住了
//     const p = await identity(c);                          // 退回玩家视角
//     if (ticket.player_id !== p.id) fail(404, '工单不存在');
//   }
//
// 那个 catch 的本意是「不是管理员就按玩家处理，让他能看自己那张单」，
// 它要接的只是 identity() 抛出的 401/403。但回避校验的 fail(403) 也在
// 同一个 try 里，状态码一模一样，于是也被接住、被当成「你不是管理员」。
//
// 实际发生的事：那两句 403 被接住后，代码退回 `identity(c)` 按**玩家**视角重走。
// 本文件这批夹具里的管理员都只有管理员会话、没有玩家会话，于是玩家身份那一步
// 抛 401，最终到前端的是 401「需要市民账号」，而不是 403。
// （如果那位管理员同时有玩家会话、又不是这张单的提交人，才会走到 404
// 「工单不存在」那一支 —— 同样是错的，只是错得不一样。）
//
// 危害有两层：
//   · 对被投诉的管理员本人：401 让他完全看不懂发生了什么 —— 是没登录？
//     是这张单不存在？还是「你是被投诉的那个」？回避规则一个字都没传达。
//   · 对后台排查：普通管理员碰一张「仅限超管」的投诉单，拿到的也是 401，
//     完全看不出这里本来该有一句「此投诉仅限超管处理」。
//
// 修法：把「取管理员身份」和「回避校验」拆成两段。catch 只包前者。
// 玩家分支的行为一个字不动（仍然是 404 对本人、其余 404）。
//
// 触达路径：ticketOwner 被 ticket-attachments.js 与 uploads.js 调用。
// 这里直接对 ticketOwner 本身做场景测试（它是导出的），比绕整条 HTTP 链路
// 少一层不确定性，且能分别断言两个 403 分支。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { ticketOwner } from '../functions/_core/uploads.js';
import { hashPassword } from '../functions/_shared/auth.js';

const DB = database();
const env = { DB };
const SECRET = 'Cose-Recusal-Test-9!';

const SESSION = {
  super: 'rc-super',
  staff: 'rc-staff',
  plain: 'rc-plain',
  target: 'rc-target',
};

/** 造一个带 Cookie 的假 context（ticketOwner 只用到 request 与 env） */
const ctxFor = (token, method = 'POST') => ({
  request: new Request('https://local.test/api/ticket-attachments', {
    method,
    headers: { Cookie: `lc_session=${token}` },
  }),
  env,
});

const call = (token, reference, method = 'POST') => {
  try {
    // ticketOwner 是 async，403/404 都是 reject，所以要 await 后再判定
    return ticketOwner(ctxFor(token, method), reference).then(
      (t) => ({ ok: true, ticket: t }),
      (e) => ({ ok: false, status: e.status, message: e.message })
    );
  } catch (e) {
    return Promise.resolve({ ok: false, status: e.status, message: e.message });
  }
};

before(async () => {
  await ensureDatabase(DB);
  const { hash, salt } = await hashPassword(SECRET);
  // 1 = 超管；2 = 普通管理员（就是被投诉的那位）；3 = 无关普通管理员
  for (const [id, name, role, linked] of [
    [1, 'super', 'super', null],
    [2, 'staff', 'admin', 5],
    [3, 'other', 'admin', null],
  ]) {
    await DB.prepare(
      'INSERT INTO admins(id,username,password_hash,salt,role,linked_player_id) VALUES(?,?,?,?,?,?)'
    ).bind(id, name, hash, salt, role, linked).run();
  }
  for (const [id, name] of [[5, 'linked-player'], [6, 'reporter']]) {
    await DB.prepare(
      "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(?,?,?,?,?,'active',0)"
    ).bind(id, name, name + '@example.invalid', hash, salt).run();
  }
  for (const token of Object.values(SESSION)) {
    await DB.prepare(
      "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,NULL,NULL,'2099-01-01T00:00:00Z')"
    ).bind(token).run();
  }
  // 把四个管理员会话真的绑到对应管理员上
  const bind = async (token, adminId) => {
    await DB.prepare('UPDATE sessions SET admin_id=? WHERE token=?').bind(adminId, token).run();
  };
  await bind(SESSION.super, 1);
  await bind(SESSION.staff, 2);
  await bind(SESSION.plain, 3);
  await bind(SESSION.target, 2);

  // 纯玩家会话：工单 1 和 2 的 player_id 都是 6
  await DB.prepare(
    "INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('rc-player',6,NULL,'2099-01-01T00:00:00Z')"
  ).run();

  // 投诉单：投诉对象是管理员 2；另有一张普通单和一张「仅限超管」的投诉
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,title,body,status) VALUES(1,6,'report','被投诉的单','描述','open')"
  ).run();
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,title,body,status,target_admin_id) VALUES(2,6,'admin_complaint','投诉单','描述','open',2)"
  ).run();
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,title,body,status,target_player_id) VALUES(3,6,'report','针对玩家的单','描述','open',5)"
  ).run();
  // 归属玩家 5 的单：给「玩家看别人的单 → 404」用
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,title,body,status) VALUES(4,5,'service','别人的单','描述','open')"
  ).run();
});

after(() => {
  try {
    DB.close();
  } catch {
    // 幂等
  }
});

// ── 1. 回避校验必须回 403，而不是被吞掉的 401 ───────────────────────────

test('被投诉的管理员处理投诉单 → 403「被投诉人不能处理该工单」', async () => {
  const r = await call(SESSION.staff, '2');
  assert.equal(r.ok, false, '被投诉人处理该单必须被拒');
  assert.equal(r.status, 403, `必须是 403（回避），实际 ${r.status}：${r.message}`);
  assert.equal(r.message, '被投诉人不能处理该工单');
});

test('非超管处理指名管理员的投诉单 → 403「此投诉仅限超管处理」', async () => {
  // 管理员 3 不是被投诉人，但也不是超管，所以落到「仅限超管」这一条
  const r = await call(SESSION.plain, '2');
  assert.equal(r.status, 403, `必须是 403，实际 ${r.status}：${r.message}`);
  assert.equal(r.message, '此投诉仅限超管处理');
});

test('针对玩家的单：被投诉玩家所绑定账号的管理员 → 403', async () => {
  // 管理员 2 绑定了玩家 5，单 3 指名玩家 5
  const r = await call(SESSION.staff, '3');
  assert.equal(r.status, 403, `必须是 403，实际 ${r.status}：${r.message}`);
  assert.equal(r.message, '被投诉人不能处理该工单');
});

// ── 2. 该放行的仍然放行（别把 403 修过头）─────────────────────────────

test('超管处理指名管理员的投诉单 → 放行', async () => {
  const r = await call(SESSION.super, '2');
  assert.equal(r.ok, true, '超管不该被回避规则挡住：' + JSON.stringify(r));
  assert.equal(r.ticket.id, 2);
});

test('无关管理员处理普通单 → 放行（这条盯的是 null === null 那个坑）', async () => {
  // 工单 1 既没指名管理员也没指名玩家；管理员 3 没有绑定玩家账号。
  // 于是 ticket.target_player_id === admin.linked_player_id 是 null === null，
  // 结果为 **true**，旧代码会误判成「涉及回避」→ 403 → 再被吞成 401。
  // 也就是说：任何没绑定玩家账号的普通管理员，连普通工单都办不了。
  const r = await call(SESSION.plain, '1');
  assert.equal(r.ok, true, '没有回避关系就该放行：' + JSON.stringify(r));
  assert.equal(r.ticket.id, 1);
});

test('绑定了玩家账号的管理员处理普通单 → 同样放行', async () => {
  const r = await call(SESSION.staff, '1');
  assert.equal(r.ok, true, '绑定了玩家不等于跟这张单有回避关系：' + JSON.stringify(r));
});

test('GET 只豁免「回避」那一条，不豁免「仅限超管」那一条', async () => {
  // 这是代码本来的结构：方法判断只包在第一条上。
  // 保持不变，只把实际行为钉住，免得以后有人以为「GET 全都放行」。
  const view = await call(SESSION.super, '2', 'GET');
  assert.equal(view.ok, true, '超管 GET 放行：' + JSON.stringify(view));

  // 管理员 2 本人正是被投诉对象 → 第一条（回避）对 GET 豁免
  // 但工单指名了管理员 → 第二条（仅限超管）仍然生效
  const staff = await call(SESSION.staff, '2', 'GET');
  assert.equal(staff.status, 403, 'GET 只豁免回避那一条：' + JSON.stringify(staff));
  assert.equal(staff.message, '此投诉仅限超管处理');
});

// ── 3. 玩家分支一个字都不能变 ───────────────────────────────────────────

test('玩家读自己那张单 → 放行', async () => {
  const r = await call('rc-player', '1');
  assert.equal(r.ok, true, '玩家看自己的单必须放行：' + JSON.stringify(r));
});

test('玩家看别人的单 → 404「工单不存在」（不给「存在」这个信息）', async () => {
  // 工单 4 归玩家 5，而 rc-player 是玩家 6
  const r = await call('rc-player', '4');
  assert.equal(r.ok, false, '看别人的单必须被拒');
  assert.equal(r.status, 404);
  assert.equal(r.message, '工单不存在');
});

test('未登录 → 401', async () => {
  const r = await call('nope', '1');
  assert.equal(r.status, 401, `必须是 401，实际 ${r.status}：${r.message}`);
});

test('不存在的工单 → 404，且这一条不依赖身份', async () => {
  const r = await call(SESSION.super, '999');
  assert.equal(r.status, 404);
  assert.equal(r.message, '工单不存在');
});

// ── 4. 判据自检：把 catch 还原成旧写法，这三条必须变红 ───────────────────
//
// 旧写法的等价物：把回避校验的 403 当成「不是管理员」接住，退回玩家视角。
// 这里用一个「吞掉 403」的 wrapper 模拟，确认上面那些 403 断言真的有牙。
//
// 吞掉之后给什么，要按**这批夹具的真实情形**来：夹具里的管理员都只有管理员
// 会话、没有玩家会话，所以旧代码退回 identity(c) 时抛的是 401「需要市民账号」。
// （曾把这个模型写成 404 —— 那是另一种情形下的结果，与本文件实测的旧行为不符；
//  模型给什么都不影响上面断言的牙，但一个说谎的模型会误导下一个人。）

const swallowRecusal = (fn) => async (c, ref) => {
  try {
    return await fn(c, ref);
  } catch (e) {
    if (e.status === 403) {
      // 旧代码的退路：当成「不是管理员」，退回玩家视角重走
      const e2 = new Error('需要市民账号');
      e2.status = 401;
      throw e2;
    }
    throw e;
  }
};

test('判据自检：若把 403 吞成 401，上面那些 403 断言会失败', async () => {
  const broken = swallowRecusal(ticketOwner);
  const r = await broken(ctxFor(SESSION.staff), '2').then(
    () => ({ ok: true }),
    (e) => ({ ok: false, status: e.status, message: e.message })
  );
  assert.equal(r.status, 401, '前提变了：吞 403 的实现确实给出 401');
  assert.equal(r.message, '需要市民账号', '且是与基线实测一致的那句文案');
  assert.notEqual(r.status, 403, '所以上面那些要求 403 的断言是有牙的');
});

test('判据自检：null === null 那条断言有牙（去掉守卫就会红）', async () => {
  // 复刻旧代码第二段那个比较：少了 `ticket.target_player_id &&` 守卫
  const oldSecondRule = (admin, ticket) =>
    admin.role !== 'super' && (ticket.target_admin_id || ticket.target_player_id === admin.linked_player_id);

  const unlinkedAdmin = { role: 'admin', linked_player_id: null };
  const plainTicket = { target_admin_id: null, target_player_id: null };

  assert.equal(
    oldSecondRule(unlinkedAdmin, plainTicket),
    true,
    '前提：旧写法确实把「都没指名」误判成「涉及回避」'
  );
  // 加上守卫后，同一份数据判为「不涉及」。
  // 注意守卫表达式在 target_player_id 为 null 时求值出的是 `null` 而不是
  // `false`（`null || (null && …)`），生产代码用的是 `if (... && namesSomeone)`
  // 这种真假判断，所以 null 与 false 等价 —— 这里就按 falsy 断言。
  const guarded = (admin, t) =>
    admin.role !== 'super' && (t.target_admin_id || (t.target_player_id && t.target_player_id === admin.linked_player_id));
  assert.ok(!guarded(unlinkedAdmin, plainTicket), '加上守卫后不该再误判');
});
