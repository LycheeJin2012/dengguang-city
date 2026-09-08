import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { api as homeApi, relativeTime } from '../js/home/util.js';
import { api as adminApi, cacheSet, cacheGet, cacheClear, STATUS_LABEL } from '../js/admin/core.js';
import { getLang, setLang, t } from '../js/i18n/core.js?v=n5';
import { onRequestPost as book } from '../functions/api/bookings.js';
import { onRequestGet as initGet } from '../functions/api/init.js';
import { ok } from '../functions/_shared/http.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('all frontend and Functions modules link with valid named exports', async () => {
  for (const f of [...walk(path.join(root, 'js')), ...walk(path.join(root, 'functions'))].filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    const modules = new Map();
    const get = p => {
      if (!modules.has(p)) modules.set(p, new vm.SourceTextModule(fs.readFileSync(p, 'utf8'), { identifier: p }));
      return modules.get(p);
    };
    await assert.doesNotReject(() => get(f).link((s, m) => get(path.resolve(path.dirname(m.identifier), s.split('?')[0]))), f);
  }
});

test('stateful frontend modules use a single URL identity', () => {
  const seen = new Map();
  for (const f of walk(path.join(root, 'js')).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+\.js(?:\?[^'"]*)?)\1/g)) {
      const u = new URL(m[2], 'file://' + f);
      if (seen.has(u.pathname)) assert.equal(u.search, seen.get(u.pathname), `Duplicate module instance: ${u.pathname}`);
      seen.set(u.pathname, u.search);
    }
  }
});

test('relative time and admin labels can call their translation function', () => {
  assert.equal(relativeTime(new Date().toISOString()), '刚刚');
  assert.equal(relativeTime(new Date(Date.now() - 120000).toISOString()), '2 分钟前');
  assert.equal(STATUS_LABEL.pending, '待审批');
});

test('cache clear deletes only matching keys, or all keys without a prefix', () => {
  cacheSet('players:1', 1); cacheSet('rooms:1', 2);
  cacheClear('players:'); assert.equal(cacheGet('players:1'), null); assert.equal(cacheGet('rooms:1'), 2);
  cacheClear(); assert.equal(cacheGet('rooms:1'), null);
});

test('401 writes reject while unauthenticated GET probes remain readable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: '请先登录' }), { status: 401 });
  try {
    for (const api of [homeApi, adminApi]) {
      assert.equal((await api('GET', '/api/login')).ok, false);
      for (const method of ['POST', 'PATCH', 'DELETE']) await assert.rejects(() => api(method, '/api/bookings', {}), /请先登录/);
    }
  } finally { globalThis.fetch = original; }
});

test('language changes update shared admin translations and preserve empty English units', () => {
  globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
  globalThis.window = { dispatchEvent() {} };
  try {
    setLang('en');
    assert.equal(getLang(), 'en');
    assert.equal(STATUS_LABEL.pending, t('admin.statusLabel.pending'));
    assert.equal(t('board.unit.messages'), '');
  } finally { setLang('zh-CN'); delete globalThis.document; delete globalThis.window; }
});

function database(session = { player_id: 7, expires_at: '2099-01-01T00:00:00Z' }, room = {}) {
  const writes = [];
  return { writes, DB: { prepare(sql) {
    let params = [];
    return { bind(...p) { params = p; return this; }, async first() {
      if (sql.includes('FROM sessions')) return session;
      if (sql.includes('FROM hotel_rooms')) return { room_id: 2, room_name: '数据库房型', capacity: 2, room_active: 1, hotel_active: 1, ...room };
      throw new Error('Unexpected query: ' + sql);
    }, async all() { throw new Error('Unauthorized query: ' + sql); }, async run() { writes.push({ sql, params }); return { meta: { last_row_id: 11 } }; } };
  } } };
}
const validBooking = { room_id: 2, room_name: '伪造名称', in_date: '2026-10-01', out_date: '2026-10-03', persons: 2, name: '测试用户', contact: 'test@example.invalid' };
async function submit(body, env = database()) {
  return { response: await book({ env, request: new Request('https://test.invalid/api/bookings', { method: 'POST', headers: { Cookie: 'lc_session=test' }, body: JSON.stringify(body) }) }), env };
}
test('booking accepts numeric and string IDs, uses authoritative room name and creates ticket', async () => {
  for (const room_id of [2, '2']) {
    const { response, env } = await submit({ ...validBooking, room_id });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).nights, 2);
    assert.equal(env.writes.length, 2);
    assert.equal(env.writes[0].params[2], '数据库房型');
  }
});
test('booking rejects invalid dates, NaN/fractional/over-capacity guests and admin-only sessions', async () => {
  for (const patch of [{ in_date: '2026-02-30' }, { in_date: 123 }, { persons: 'abc' }, { persons: 1.5 }, { persons: 3 }, { persons: 0 }, { room_id: -1 }]) {
    const { response, env } = await submit({ ...validBooking, ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch)); assert.equal(env.writes.length, 0);
  }
  const { response } = await submit(validBooking, database({ admin_id: 1, expires_at: '2099-01-01T00:00:00Z' }));
  assert.equal(response.status, 401);
  const draft = await submit(validBooking, database(undefined, { hotel_active: 0 }));
  assert.equal(draft.response.status, 400); assert.equal(draft.env.writes.length, 0);
});
test('legacy players-list rejects player sessions before reading personal data', async () => {
  const response = await initGet({ env: database(), request: new Request('https://test.invalid/api/init?action=players-list', { headers: { Cookie: 'lc_session=test' } }) });
  assert.equal(response.status, 401);
});
test('JSON defaults to no-store and public responses can explicitly opt into caching', () => {
  assert.equal(ok({}).headers.get('Cache-Control'), 'no-store');
  assert.equal(ok({}, { headers: { 'Cache-Control': 'public, max-age=60' } }).headers.get('Cache-Control'), 'public, max-age=60');
});
test('service worker bypasses all API responses, preserves unrelated caches, and refreshes static files', async () => {
  const handlers = {}, deleted = [], stored = [];
  const context = vm.createContext({ URL, Response, Promise,
    self: { location: { origin: 'https://test.invalid' }, addEventListener: (type, fn) => handlers[type] = fn, clients: { claim() {} } },
    caches: { keys: async () => ['lc-old', 'another-app'], delete: async k => deleted.push(k), match: async () => undefined,
      open: async () => ({ put: async (req) => stored.push(req.url) }) },
    fetch: async () => new Response('ok')
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  let activation; handlers.activate({ waitUntil(p) { activation = p; } }); await activation;
  assert.deepEqual(deleted, ['lc-old']);
  for (const pathname of ['/api/login', '/api/notifications?my=1', '/api/init?action=players-list', '/logout']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url: 'https://test.invalid' + pathname, mode: 'cors' }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, pathname);
  }
  let response; const pending = [];
  handlers.fetch({ request: { method: 'GET', url: 'https://test.invalid/js/main.js', mode: 'cors' }, waitUntil(p) { pending.push(p); }, respondWith(p) { response = p; } });
  assert.equal((await response).status, 200); await Promise.all(pending); assert.equal(stored.length, 1);
});

test('ordinary admins cannot reset another admin password or mutate account management fields', async () => {
  const { onRequestPatch } = await import('../functions/api/admin/admins.js');
  const queried = [];
  const env = { DB: { prepare(sql) { queried.push(sql); return { bind() { return this; }, async first() {
    if (sql.includes('FROM sessions')) return { admin_id: 2, expires_at: '2099-01-01T00:00:00Z' };
    if (sql.startsWith('SELECT id, role FROM admins')) return { id: 2, role: 'admin' };
    throw new Error('Should reject before querying target');
  }, async run() { assert.fail('Should not write'); } }; } } };
  const result = await onRequestPatch({ env, request: new Request('https://test.invalid/api/admin/admins?id=1', { method:'PATCH', headers:{Cookie:'lc_session=test'}, body:JSON.stringify({new_password:'test-only-value'}) }) });
  assert.equal(result.status, 403); assert.equal(queried.length, 2);
});

test('admin form accepts the real login POST response shape and preserves password spaces', async () => {
  let submit, sent;
  const button = { textContent: '', disabled: false }, error = { textContent: '' };
  const form = { addEventListener(type, fn) { if (type === 'submit') submit = fn; } };
  const nodes = { '#loginForm':form, '#loginUser':{value:'test-user'}, '#loginPass':{value:' test password '}, '#loginSubmitBtn':button, '#loginError':error };
  const context = vm.createContext({ console:{log(){},warn(){},error(){}}, window:{}, document:{
    querySelector:s=>nodes[s]||null, querySelectorAll:()=>[], getElementById:()=>null, addEventListener(){}
  }, setTimeout(){return 1;},clearTimeout(){} });
  const core = new vm.SyntheticModule(['$','POST','GET','safeRender','fileToDataURLP','cacheClear','esc'], function() {
    this.setExport('$',s=>nodes[s]||null); this.setExport('POST',async(p,b)=>{sent=b;return {ok:true,user_id:1,role:'super'};});this.setExport('GET',async()=>({ok:false}));
    for(const n of ['safeRender','fileToDataURLP','cacheClear','esc'])this.setExport(n,()=>{});
  },{context});
  const dash = new vm.SyntheticModule(['renderDash','_ensureTabRendered','bindFilterRadios','showView'],function(){for(const n of ['renderDash','_ensureTabRendered','bindFilterRadios','showView'])this.setExport(n,()=>{});},{context});
  const i18n = new vm.SyntheticModule(['t'],function(){this.setExport('t',(k,f)=>f||k);},{context});
  const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root,'js/admin.js'),'utf8'),{context});
  await mod.link(s=>s.includes('i18n')?i18n:s.includes('dash')?dash:core);await mod.evaluate();
  await submit({preventDefault(){}});
  assert.equal(sent.password,' test password ');assert.equal(button.textContent,'✓ 登录成功');assert.equal(error.textContent,'');
});

test('SQLite and ISO timestamps normalize to the same instant without double Z', async () => {
  const { parseDate } = await import('../js/date.js');
  for (const value of ['2026-09-08 04:00:00', '2026-09-08T04:00:00Z', '2026-09-08T12:00:00+08:00']) {
    assert.equal(parseDate(value).toISOString(), '2026-09-08T04:00:00.000Z');
  }
  assert.ok(Number.isNaN(parseDate('invalid').getTime()));
});
