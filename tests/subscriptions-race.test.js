// subscriptions 的并发重订阅竞态。
//
// 背景：表上**没有** UNIQUE 约束（加约束要动 _schema.js 里的生产迁移），而
// 原来的实现是典型的 check-then-act：
//
//     SELECT ... WHERE player_id=? AND type=?   → 查不到
//     INSERT INTO subscriptions(...)           → 插进去
//
// 两次请求可以同时停在「查不到」这一步，然后都插进去。实测**6 个并发请求
// 留下 6 行**（早前一次审查报的是 4 行，实际更糟）。
//
// 危害不是「多几行」本身，而是软停用：取消订阅走的是
// `UPDATE ... SET enabled=0 WHERE id=?`，一次只关一行。用户点了取消订阅，
// 另一行还 enabled=1，通知照收 —— 表现为「取消不掉」。
//
// 修法是把检查和写入收进**同一条 INSERT … SELECT … WHERE NOT EXISTS**：
// SQLite 里一条 INSERT 语句是原子的，持有写锁，两个并发请求只有一个能插进来。
// 输的那个 changes=0，回查赢家的 id 复用，语义与「已存在就复用」一致。
//
// 注意：本用例必须真并发（Promise.all）才有效。串行跑的话每个请求都
// SELECT-INSERT 走完整轮，老代码也不会重复 —— 那样这条测试就是假绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';

const CONCURRENCY = 6;

/** 起一个只含一名市民的库，返回 subscribe 一次要用的请求工厂 */
async function scene(fn) {
  const DB = database();
  try {
    await ensureDatabase(DB);
    // 关掉派单，否则并发插入会顺带触发真实派单逻辑，把断言搅浑
    await DB.prepare('UPDATE dispatch_settings SET enabled=0 WHERE id=1').run();
    await DB
      .prepare(
        "INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(1,'racer','r@example.invalid','x','x','active')"
      )
      .run();
    await DB
      .prepare("INSERT INTO sessions(token,player_id,expires_at) VALUES('race-token',1,'2099-01-01T00:00:00Z')")
      .run();

    const env = { DB };
    const subscribe = () =>
      dispatch(
        new Request('https://local.test/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: 'lc_session=race-token' },
          body: JSON.stringify({ type: 'announcement', channel: 'site' }),
        }),
        env
      );

    await fn({ DB, subscribe });
  } finally {
    DB.close();
  }
}

test('并发重订阅只留一行：6 个请求打进去不能插出 6 条', () =>
  scene(async ({ DB, subscribe }) => {
    const replies = await Promise.all(Array.from({ length: CONCURRENCY }, () => subscribe()));

    const n = (
      await DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE player_id=1 AND type=?').bind('announcement').first()
    ).n;
    assert.equal(n, 1, `6 个并发请求应该只留 1 行，实际留了 ${n} 行 —— check-then-act 竞态没堵住`);

    // 防退化：确认请求确实发出去了，不是被鉴权挡在门外导致「一行都没有」
    const bodies = await Promise.all(replies.map((r) => r.json()));
    for (const b of bodies) assert.ok(b && typeof b === 'object', '每个请求都应返回 JSON');
    assert.equal(replies.length, CONCURRENCY);
  }));

test('并发时输掉竞态的那几个返回赢家的 id，语义等同「已存在就复用」', () =>
  scene(async ({ DB, subscribe }) => {
    const replies = await Promise.all(Array.from({ length: CONCURRENCY }, () => subscribe()));
    const ids = new Set();
    for (const r of replies) {
      const b = await r.json();
      assert.ok(Number.isInteger(b.id) && b.id > 0, `每个响应都该带一个有效 id，实际 ${JSON.stringify(b)}`);
      ids.add(b.id);
    }
    // 全都指向同一行，否则调用方会以为订了两条
    assert.equal(ids.size, 1, `6 个并发响应应指向同一个 id，实际拿到 ${[...ids].join(', ')}`);

    // 只有一个请求是「新建」（201），其余是「已存在」（200）——这正是原语义的延续
    const codes = replies.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 201).length, 1, `应当恰好一个 201，实际 ${codes.join(',')}`);
  }));

test('订阅过一次再重复订阅，不会变出第二行（串行也要成立）', () =>
  scene(async ({ DB, subscribe }) => {
    await subscribe();
    await subscribe();
    await subscribe();
    const n = (
      await DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE player_id=1').first()
    ).n;
    assert.equal(n, 1, `串行重复订阅应恒为 1 行，实际 ${n}`);
  }));

test('并发订阅后取消订阅能真的关掉 —— 这是本 bug 真正的危害所在', () =>
  scene(async ({ DB, subscribe }) => {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => subscribe()));

    const row = (
      await DB.prepare('SELECT id,enabled FROM subscriptions WHERE player_id=1 AND type=?').bind('announcement').first()
    );
    assert.equal(row.enabled, 1, '订阅后应为启用态');

    // 取消订阅走软停用：只关 id 指向的那一行
    const del = await dispatch(
      new Request(`https://local.test/api/subscriptions?id=${row.id}`, {
        method: 'DELETE',
        headers: { Cookie: 'lc_session=race-token' },
      }),
      { DB }
    );
    assert.equal(del.status, 200);

    // 关键断言：全表范围内都得是停用的，不能有漏网的那一行
    const still = (
      await DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE player_id=1 AND type=? AND enabled=1").bind('announcement').first()
    ).n;
    assert.equal(still, 0, `取消订阅后仍有 ${still} 行处于启用态 —— 用户会继续收到通知，即「取消不掉」`);
  }));
