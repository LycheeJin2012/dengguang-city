// 守门：店主自助台（/api/hotel-owner）——「房型与房价」tab 的改一改 / 新房型。
//
// 这个端点此前**没有任何测试覆盖**，而它是老板日常最常用的写接口。
//
// ── payload 的真实形状 ────────────────────────────────────────────────────
// 别用「对象字面量」去猜前端发什么。js/ui/dialog.js 收集表单值时做了三件事：
//   1. Object.fromEntries(new FormData(form))
//        → text / textarea / select  都是**字符串**
//   2. 每个 input[type=checkbox]  → data[name] = checked ? 1 : 0（**数字**）
//   3. 每个 input[type=number]    → data[name] = 空串 ? null : Number(v)
//        → **数字**，清空时是 **null**
// 所以「改一改」发出去的是混合体：hotel_id 是字符串、capacity 是 number、
// breakfast_included 是 0/1。下面的用例就按这个形状写。
//
// ── 为什么第 8 条最重要 ────────────────────────────────────────────────────
// 审计落库是**响应产出之后**才做的旁路写入。以前它没有兜底：房型已经存进库了，
// 审计那条 INSERT 一抛错，整个请求被 endpoint 翻成 500，用户看到「保存失败」，
// 于是再点一次 —— 可能连着提交两遍，而且他无法判断第一次到底存没存进去。
// 这条测试故意把 audit_events 弄坏，验证「保存成功就必须是 200」。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { hashPassword } from '../functions/_shared/auth.js';

const DB = database();
const env = { DB };
const OWNER = 'ho-owner';

/** 老板存一单房型时 dialog.js 真正会组出来的对象 */
const UI_EDIT = {
  hotel_id: '1', // select → 字符串
  name: '小型大床房', // text → 字符串
  capacity: 2, // number → Number
  beds: '大床',
  price_per_night: 79, // number → Number
  breakfast_included: 1, // checkbox → 1
  description: '',
  image_url: '',
  is_active: 1, // checkbox → 1
};

before(async () => {
  await ensureDatabase(DB);
  const { hash, salt } = await hashPassword('Hotel-Owner-9!');
  await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(1,'boss','boss@example.invalid',?,?,'active')").bind(hash, salt).run();
  await DB.prepare("INSERT INTO hotel_owners(id,username,password_hash,salt,status) VALUES(1,'boss',?,?,'active')").bind(hash, salt).run();
  await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,hotel_owner_id,expires_at) VALUES(?,NULL,NULL,1,'2099-01-01T00:00:00Z')").bind(OWNER).run();
  // 名下两间店：能测「挂到别家店要拒绝」，也能测 select 选了分店
  await DB.prepare("INSERT INTO hotels(id,name,owner_id,is_active) VALUES(1,'我的酒店',1,1)").run();
  await DB.prepare("INSERT INTO hotels(id,name,owner_id,is_active) VALUES(2,'分店',1,1)").run();
  await DB.prepare("INSERT INTO hotels(id,name,owner_id,is_active) VALUES(3,'别家的店',9,1)").run();
  await DB.prepare(
    "INSERT INTO hotel_rooms(id,hotel_id,name,capacity,beds,breakfast_included,price_per_night,description,image_url,sort_order,is_active) VALUES(1,1,'小型大床房',2,'大床',1,79,'介绍','',0,1)"
  ).run();
});

after(() => {
  try {
    DB.close();
  } catch {
    // 幂等
  }
});

const call = async (method, path, body, token = OWNER, useEnv = env, useDb = DB) => {
  const response = await dispatch(
    new Request('https://local.test' + path, {
      method,
      headers: { Cookie: `lc_session=${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    useEnv
  );
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 响应保持 null，断言里会直接看出来
  }
  return { http: response.status, json, text, useDb };
};

const room = async (id) => (await DB.prepare('SELECT * FROM hotel_rooms WHERE id=?').bind(id).first());

// ── 1~3. 改一改：三种 UI 形状都必须成功且真的落库 ─────────────────────────

test('改一改：UI 原始 payload → 200 且字段真的改了', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=1', { ...UI_EDIT, name: '改过的名字', price_per_night: 99 });
  assert.equal(r.http, 200, r.text);
  assert.equal(r.json.ok, true);
  const row = await room(1);
  assert.equal(row.name, '改过的名字', '名字要真的写进库');
  assert.equal(row.price_per_night, 99, '房价要真的写进库');
  assert.equal(row.hotel_id, 1, 'select 传来的字符串 "1" 要落成数字 1');
  assert.ok(row.updated_at, 'updated_at 要被刷新');
});

test('改一改：两个数字框被清空（→ null）→ 200，且按规则回落到缺省值', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=1', {
    ...UI_EDIT,
    capacity: null,
    price_per_night: null,
  });
  assert.equal(r.http, 200, r.text);
  const row = await room(1);
  // capacity 的缺省是 2，price_per_night 的缺省是 0
  assert.equal(row.capacity, 2, 'capacity 为 null 时应回落到规则缺省 2');
  assert.equal(row.price_per_night, 0, 'price_per_night 为 null 时应回落到规则缺省 0');
});

test('改一改：两个勾选框都取消（→ 0）→ 200，且真的存成 0', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=1', {
    ...UI_EDIT,
    breakfast_included: 0,
    is_active: 0,
  });
  assert.equal(r.http, 200, r.text);
  const row = await room(1);
  assert.equal(row.breakfast_included, 0, '取消早餐要真的存成 0（0 不是 nullish，不能被缺省值覆盖）');
  assert.equal(row.is_active, 0, '停业要真的存成 0');
  // 复原，免得影响后面的用例
  await DB.prepare('UPDATE hotel_rooms SET breakfast_included=1,is_active=1 WHERE id=1').run();
});

// ── 4~6. 该拒的必须给**具体**的 4xx，不能是笼统的 500 ────────────────────

test('改一改：capacity 越界 → 400 且说清是哪个字段', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=1', { ...UI_EDIT, capacity: 9 });
  assert.equal(r.http, 400, '越界必须是 400，不能变成 500：' + r.text);
  assert.match(r.json.error, /capacity/, '报错要指名 capacity：' + r.json.error);
});

test('改一改：挂到别家的店 → 404「所属酒店不存在」', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=1', { ...UI_EDIT, hotel_id: '3' });
  assert.equal(r.http, 404, r.text);
  assert.equal(r.json.error, '所属酒店不存在');
});

test('改一改：不存在的房型 → 404「记录不存在」', async () => {
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=9999', { ...UI_EDIT });
  assert.equal(r.http, 404, r.text);
  assert.equal(r.json.error, '记录不存在');
});

// ── 7. 新房型 + 操作记录 ─────────────────────────────────────────────────

test('＋ 新房型：POST → 201 且真的插进去了', async () => {
  const r = await call('POST', '/api/hotel-owner?entity=rooms', {
    hotel_id: '1',
    name: '新房型',
    capacity: 2,
    beds: '',
    price_per_night: 50,
    breakfast_included: 1,
    description: '',
    image_url: '',
    is_active: 1,
  });
  assert.equal(r.http, 201, r.text);
  const row = await room(r.json.id);
  assert.ok(row, '返回的 id 要真的能查到');
  assert.equal(row.name, '新房型');
  assert.equal(row.hotel_id, 1);
});

test('操作记录：改完之后能查到这条 patch 审计', async () => {
  const r = await call('GET', '/api/hotel-owner?history=1&entity=rooms&id=1');
  assert.equal(r.http, 200, r.text);
  assert.ok(Array.isArray(r.json.events), 'events 要是数组');
  assert.ok(r.json.events.some((e) => e.action === 'patch'), '刚才那次改动要有审计记录');
});

// ── 8. 审计写挂了，不能把本来该回的结果变成 500 ──────────────────────────
//
// 这是本次修的那个缺陷的守门。
//
// 背景：房型改动这种「数据写 + 审计写」在**同一个 batch() 里**，所以审计表坏掉时
// 数据本来就没存上，500 是对的。真正会出问题的是另一种：请求在写入之前就被拒
// （比如 404 / 400），此时 writeAudit 是**唯一**那一条审计 INSERT。以前它没兜底，
// 一抛错整个请求被 endpoint 翻成 500 —— 用户点了个不存在的房型，却被告知
// 「服务处理失败」，而正确的答案是「记录不存在」。
//
// 做法：只让 audit_events 那一条 INSERT 抛错，其它语句照常走真库。
// 改动前这条断言拿到 500，改动后拿到 404。

test('审计写失败时，请求原本的结果必须原样返回（404 不能变成 500）', async () => {
  const broken = {
    prepare(sql) {
      if (/INSERT INTO audit_events/i.test(String(sql))) {
        return {
          bind: () => ({
            run: async () => {
              throw new Error('audit 表不可用');
            },
          }),
        };
      }
      return DB.prepare(sql);
    },
    batch: (items) => DB.batch(items),
  };

  // id=9999 不存在 → 路由在任何写入之前就 fail(404)
  const r = await call('PATCH', '/api/hotel-owner?entity=rooms&id=9999', { ...UI_EDIT }, OWNER, { DB: broken });

  assert.equal(r.http, 404, '审计挂了就报 500，等于把「记录不存在」说成「服务炸了」：' + r.text);
  assert.equal(r.json.error, '记录不存在');
});
