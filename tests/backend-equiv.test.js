// 后端重写的等价性守门。
//
// 背景：v88.7 把整个后端从「手工压缩写法」重写成可读代码，跨了 118 个文件
// （43 个路由 + 25 个 _core + 3 个 _shared）。同一批压缩病：最长的一行有
// 1730 字节（_core/chat-support.js 整个文件才 12 行）。
//
// 这种规模的纯重构最怕的是「手滑改了某个 WHERE 条件或某个扣费顺序，
// 而当场看不出来」——要等到线上才发现。所以这里逐个文件做两件事：
//
//   1. export 名单必须一致（别的文件在 import，改了就断链）
//   2. **拿真 SQLite 跑两版**，比对真实落库结果
//
// 为什么用真库而不是假 DB：
// 假 DB 只能记录「发了什么 SQL」，而这里的风险恰恰是「SQL 一样但事务语义不同」——
// 比如扣费那条少了 emeralds>=? 条件、或者报名 INSERT 没等 changes()=1。
// 真库会直接把透支、重复报名这些后果暴露出来。
//
// 基线是重构前的提交（下面 BASELINE）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { database } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';

const BASELINE = '06e9595';

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });
const read = (p) => readFileSync(p, 'utf8');

/** 基线里有、现在还在、且确实被改动过的后端文件 */
const CHANGED = execSync(`git ls-tree -r --name-only ${BASELINE} -- functions/`, { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.js') && existsSync(f) && show(f) !== read(f));

const exportNames = (src) =>
  [...src.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)]
    .map((m) => m[1])
    .concat(
      [...src.matchAll(/export\s*\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/).pop().trim()))
        .filter(Boolean)
    )
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

test(`后端重写没改任何 export 名单（对照 ${BASELINE}，检查 ${CHANGED.length} 个改动文件）`, () => {
  const problems = [];
  for (const path of CHANGED) {
    const before = exportNames(show(path));
    const after = exportNames(read(path));
    const lost = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    if (lost.length || added.length) {
      problems.push(`${path}: 少了 [${lost.join(' ')}]，多了 [${added.join(' ')}]`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/** 建一份全新的真库，塞进重写测试需要的最小数据 */
async function fixture() {
  const DB = database();
  await ensureDatabase(DB);

  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds) VALUES(1,'citizen','test@example.invalid','x','x','active',1000)"
  ).run();
  await DB.prepare("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(1,'super','super','x','x')").run();
  await DB.prepare("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(2,'wzc','admin','x','x')").run();
  // 两个会话：玩家 / 超管
  await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('player',1,NULL,'2099-01-01 00:00:00')").run();
  await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES('super',NULL,1,'2099-01-01 00:00:00')").run();

  // 一间酒店 + 一个房型，供预订路径用
  await DB.prepare("INSERT INTO hotels(id,name,is_active) VALUES(1,'树上酒店',1)").run();
  await DB.prepare(
    'INSERT INTO hotel_rooms(id,hotel_id,name,capacity,price_per_night,is_active,breakfast_included) VALUES(1,1,\'大床房\',4,300,1,1)'
  ).run();
  // 一条赛道，供国际试车扣费路径用
  await DB.prepare("INSERT INTO race_tracks(id,name,trial_price,is_active) VALUES(1,'环道',500,1)").run();

  return {
    DB,
    env: { DB },
    close: () => DB.close(),
    call: async (path, method = 'GET', body, cookie = 'player') => {
      const { onRequest } = await import('../functions/api/' + path + '.js');
      const request = new Request('https://local.test/api/' + path, {
        method,
        headers: { Cookie: `lc_session=${cookie}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const r = await onRequest({ request, env: { DB }, waitUntil: (p) => p.catch(() => {}) });
      return { http: r.status, ...(await r.json()) };
    },
  };
}

/** 把一个模块的两版都装到能跑的状态 */
async function loadBoth(path) {
  const tmp = path.replace(/\.js$/, '.equiv-old.js');
  writeFileSync(tmp, show(path));
  const oldM = await import('../' + tmp);
  const newM = await import('../' + path);
  return {
    oldM,
    newM,
    cleanup: () => { try { unlinkSync(tmp); } catch {} },
  };
}

/** 读出玩家账户余额与报名行，作为「实际落库结果」的证据 */
async function snapshot(DB) {
  const player = await DB.prepare('SELECT emeralds FROM players WHERE id=1').first();
  const rows = (await DB.prepare('SELECT * FROM circuit_signups').all()).results;
  const tickets = (await DB.prepare('SELECT id,category,title,status FROM tickets ORDER BY id').all()).results;
  return { emeralds: player.emeralds, circuit: rows, tickets };
}

test('submissions：国际试车扣费、报名、工单三者原子（两版真库落库结果一致）', async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/_core/submissions.js');
  try {
    const results = [];
    for (const mod of [oldM, newM]) {
      const f = await fixture();
      try {
        const env = f.env;
        const request = {
          method: 'POST',
          url: 'https://local.test/api/circuit',
          headers: new Headers({ Cookie: 'lc_session=player' }),
          text: async () => JSON.stringify({ contact: '13800000000', track_id: 1, license: 'B' }),
        };
        const c = { env, request, waitUntil() {} };
        let http = null, body = null;
        try {
          const r = await mod.submissions('circuit')(c);
          http = r.status;
          body = await r.json();
        } catch (e) {
          http = 'THROW';
          body = { error: e.message };
        }
        results.push({ http, body, snap: await snapshot(f.DB) });
      } finally {
        f.close();
      }
    }

    const [a, b] = results;
    assert.equal(b.http, a.http, `HTTP 不一致：原 ${a.http} / 新 ${b.http}`);
    assert.deepEqual(b.snap, a.snap, '落库结果不一致（余额 / 报名 / 工单）');

    // 别让「什么都没发生」蒙混过关：必须真的扣了钱、建了单
    assert.equal(a.snap.emeralds, 500, '应从 1000 扣到 500');
    assert.equal(a.snap.circuit.length, 1, '应产生 1 条试车报名');
    assert.equal(a.snap.tickets.length, 1, '应产生 1 张工单');
  } finally {
    cleanup();
  }
});

test('submissions：余额不足时既不扣款也不建单（两版一致）', async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/_core/submissions.js');
  try {
    const results = [];
    for (const mod of [oldM, newM]) {
      const f = await fixture();
      try {
        // 把余额压到付不起
        await f.DB.prepare('UPDATE players SET emeralds=10 WHERE id=1').run();
        const request = {
          method: 'POST',
          url: 'https://local.test/api/circuit',
          headers: new Headers({ Cookie: 'lc_session=player' }),
          text: async () => JSON.stringify({ contact: '1', track_id: 1, license: 'B' }),
        };
        let http = null, body = null;
        try {
          const r = await mod.submissions('circuit')({ env: f.env, request, waitUntil() {} });
          http = r.status;
          body = await r.json();
        } catch (e) {
          http = 'THROW';
          body = { error: e.message };
        }
        results.push({ http, body, snap: await snapshot(f.DB) });
      } finally {
        f.close();
      }
    }
    const [a, b] = results;
    assert.equal(b.http, a.http);
    assert.deepEqual(b.snap, a.snap);
    // 关键：余额没动、没建单 —— 扣费失败必须整条链都不生效
    assert.equal(a.snap.emeralds, 10, '余额不应变动');
    assert.equal(a.snap.circuit.length, 0, '不应留下报名记录');
    assert.equal(a.snap.tickets.length, 0, '不应留下工单');
  } finally {
    cleanup();
  }
});

test('chat-support：needsHuman 的每条分支两版判定一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/_core/chat-support.js');
  try {
    // 每条规则都要踩到，顺带锁住「没踩到」的边界行为
    const CASES = [
      // 明确不要人工
      '不要人工', '不用人工了', '暂不需要人工', '不想找人工',
      // 明确要人工
      '转人工', '我要找客服', '找个工作人员',
      // 纯打招呼 / 致谢
      '你好', '您好！', 'hi', 'Hello.', '谢谢', '感谢！', 'thanks', '好的', '好', 'ok', '好。', 'OK!', '  好的  ',
      // 城市 FAQ
      '建市是哪年', '建城', '哪年成立', '成立年份是多少',
      // 举报投诉（不走客服排队）
      '如何举报', '怎么投诉', '我要反馈问题',
      // 兜底
      '我的订单在哪', '', '天气怎么样',
    ];
    const diffs = [];
    for (const input of CASES) {
      const a = oldM.needsHuman(input);
      const b = newM.needsHuman(input);
      if (a !== b) diffs.push(`${JSON.stringify(input)}: 原 ${a} ≠ 新 ${b}`);
    }
    // null / undefined 也要过一遍
    for (const input of [null, undefined, 0, false]) {
      const a = oldM.needsHuman(input);
      const b = newM.needsHuman(input);
      if (a !== b) diffs.push(`${JSON.stringify(input)}: 原 ${a} ≠ 新 ${b}`);
    }
    assert.deepEqual(diffs, [], diffs.join('\n'));
  } finally {
    cleanup();
  }
});

test('chat-support：publicChat 与 sensitiveChat 两版一致', async () => {
  const { oldM, newM, cleanup } = await loadBoth('functions/_core/chat-support.js');
  try {
    const ROWS = [
      null,
      { id: 1, status: 'queued', auto_handoff: 1, revision: 1, needs_ticket: 0, ticket_summary: 'x', linked_ticket_id: null, requested_at: '2026-01-01' },
      { id: 2, status: 'closed', auto_handoff: 0, revision: 3, needs_ticket: 1, ticket_summary: '要开证明', linked_ticket_id: 88, requested_at: '2026-02-02' },
    ];
    for (const r of ROWS) {
      assert.deepEqual(newM.publicChat(r), oldM.publicChat(r), `publicChat(${JSON.stringify(r)}) 不一致`);
    }
    for (const t of ['我要投诉', '举报他', '你好', '', null, undefined]) {
      assert.equal(newM.sensitiveChat(t), oldM.sensitiveChat(t), `sensitiveChat(${JSON.stringify(t)}) 不一致`);
    }
  } finally {
    cleanup();
  }
});
