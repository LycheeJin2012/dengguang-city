// 守门：模型服务健康检查（/api/admin/ai-health）—— 仅超管可见。
//
// 为什么这个端点值得单独立一组测试：
// 全站 5 个模型调用点在上游出问题时**全是静默降级**，页面照常可用、
// 管理员拿到固定模板，却没有任何地方告诉他「AI 其实没在工作」。
// 这个面板是唯一的暴露口，所以它自己的两条底线必须被钉死：
//   1. 权限只能到超管 —— 普通管理员看不到模型配置
//   2. 密钥永不出现在任何响应里 —— 包括 base_url 内嵌凭据那种情况
//
// 第 7 条是回归里最容易翻车的：有些中转服务把 key 放在 URL 的 user:pass@ 里，
// 直接回显 base_url 就等于把密钥发到了浏览器。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, dispatch } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';
import { hashPassword } from '../functions/_shared/auth.js';

const KEY = 'sk-test-DO-NOT-LEAK-abcdef123456';

async function fixture(fn, envExtra = {}) {
  const DB = database();
  const original = globalThis.fetch;
  try {
    await ensureDatabase(DB);
    const h = await hashPassword('LocalTest67!');
    await DB
      .prepare("INSERT INTO players(id,username,email,password_hash,salt,status) VALUES(1,'alice','a@test.invalid',?,?,'active')")
      .bind(h.hash, h.salt)
      .run();
    for (const [id, role] of [
      [1, 'super'],
      [2, 'admin'],
    ])
      await DB.prepare('INSERT INTO admins(id,username,password_hash,salt,role) VALUES(?,?,?,?,?)').bind(id, role, h.hash, h.salt, role).run();
    for (const [token, admin] of [
      ['super', 1],
      ['staff', 2],
    ])
      await DB.prepare("INSERT INTO sessions(token,player_id,admin_id,expires_at) VALUES(?,NULL,?,'2099-01-01T00:00:00Z')").bind(token, admin).run();

    const env = { DB, ...envExtra };
    const call = async (method = 'GET', token = 'super', data = undefined) => {
      const r = await dispatch(
        new Request('https://local.test/api/admin/ai-health', {
          method,
          headers: { 'Content-Type': 'application/json', Cookie: token ? 'lc_session=' + token : '' },
          body: data ? JSON.stringify(data) : undefined,
        }),
        env
      );
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 非 JSON 保持 null，断言里会直接看出来 */
      }
      return { http: r.status, json, text };
    };
    await fn({ DB, env, call });
  } finally {
    globalThis.fetch = original;
    DB.close();
  }
}

test('只有超管能看：普通管理员 403，未登录 401', () =>
  fixture(async ({ call }) => {
    assert.equal((await call('GET', 'staff')).http, 403, '普通管理员不得看到模型配置');
    assert.equal((await call('POST', 'staff')).http, 403, '普通管理员不得触发连通性测试');
    assert.equal((await call('GET', '')).http, 401, '未登录应当 401');
  }));

test('GET 回显生效配置，且响应里没有任何密钥片段', () =>
  fixture(
    async ({ call }) => {
      const r = await call('GET');
      assert.equal(r.http, 200, r.text);
      assert.equal(r.json.configured, true);
      assert.equal(r.json.model, 'my-model-x');
      assert.equal(r.json.base_url, 'https://relay.example.invalid/v1');
      // 逐字搜一遍：密钥、它的任意片段都不得出现
      assert.doesNotMatch(r.text, /DO-NOT-LEAK/, '响应里出现了密钥');
      assert.doesNotMatch(r.text, /sk-test/, '响应里出现了密钥前缀');
      assert.equal(r.json.key_exposed, false);
    },
    { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: 'https://relay.example.invalid/v1', OPENAI_MODEL: 'my-model-x' }
  ));

test('base_url 内嵌的 user:pass@ 必须被剥掉再回显', () =>
  fixture(
    async ({ call }) => {
      const r = await call('GET');
      assert.equal(r.http, 200, r.text);
      // 中转服务常把凭据放在 URL 里；原样回显等于把密钥发到浏览器
      assert.equal(r.json.base_url, 'https://relay.example.invalid/v1');
      assert.doesNotMatch(r.text, /INLINECRED/, 'base_url 的内嵌凭据被原样回显了');
    },
    { OPENAI_API_KEY: KEY, OPENAI_BASE_URL: 'https://user:INLINECRED@relay.example.invalid/v1' }
  ));

test('未配置密钥时 POST 直接拒绝，且一个上游请求都不发', () =>
  fixture(async ({ call }) => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error('不该被调用');
    };
    const r = await call('POST');
    assert.equal(r.http, 400);
    assert.match(r.json.error, /尚未配置/);
    assert.equal(called, false, '没有密钥却发了上游请求');
  }));

test('上游 401：带回状态码与原话，且不泄漏密钥', () =>
  fixture(
    async ({ call }) => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 });

      const r = await call('POST');
      assert.equal(r.http, 200, r.text); // 探测本身成功，是「上游失败」这一事实要报出来
      assert.equal(r.json.ok, false);
      assert.equal(r.json.status, 401);
      assert.match(r.json.error, /Incorrect API key/, '上游原话要带回来才能排查');
      assert.ok(Number.isFinite(r.json.ms), '要有耗时');
      assert.doesNotMatch(r.text, /DO-NOT-LEAK/, '失败路径泄漏了密钥');
    },
    { OPENAI_API_KEY: KEY }
  ));

test('上游成功：ok=true 且带回模型回声', () =>
  fixture(
    async ({ call }) => {
      let seen = null;
      globalThis.fetch = async (url, init) => {
        seen = { url: String(url), init };
        return new Response(JSON.stringify({ choices: [{ message: { content: '可用' } }] }), { status: 200 });
      };

      const r = await call('POST');
      assert.equal(r.http, 200, r.text);
      assert.equal(r.json.ok, true);
      assert.equal(r.json.status, 200);
      assert.equal(r.json.sample, '可用');

      // 探测必须用和线上一样的参数形状，否则测出来「通」也是假的：
      // 推理模型拒 max_tokens 这类静默降级，只有同形状才测得出。
      const sent = JSON.parse(seen.init.body);
      assert.ok('max_tokens' in sent, '探测请求必须带 max_tokens');
      assert.ok('temperature' in sent, '探测请求必须带 temperature');
      // 但 max_tokens 不能给太小。实测 MiniMax-M3.1-Flash-Preview：
      // 出一道最简单的灯谜花了 211 个 completion token，其中 182 个是 reasoning。
      // 给 16 的话预算全被思考吃掉，一个字正文都吐不出来 ——
      // 实测同一请求先 1.1s 返回、再 30s 超时，面板会随机误报「连接超时」，
      // 让超管以为没接通，而线上其实好好的。
      assert.ok(
        sent.max_tokens >= 512,
        `探测的 max_tokens 必须留出推理空间，实测 ${sent.max_tokens} 太小`
      );
      assert.match(seen.url, /\/chat\/completions$/);
      assert.equal(seen.init.headers.Authorization, 'Bearer ' + KEY);
    },
    { OPENAI_API_KEY: KEY }
  ));

test('探测回声要剥掉推理模型的 <think> 块，只显示它真正回答的那句', () =>
  fixture(
    async ({ call }) => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '<think>We need answer to 可用. Likely 可用.</think>\n\n可用' } }],
          }),
          { status: 200 }
        );
      const r = await call('POST');
      assert.equal(r.http, 200, r.text);
      assert.equal(r.json.ok, true);
      // 面板是给超管判断用的，显示一段模型自言自语只会让人以为接错了模型
      assert.equal(r.json.sample, '可用');
      assert.doesNotMatch(r.json.sample, /<think>/, '探测回声漏出了思考块');
    },
    { OPENAI_API_KEY: KEY }
  ));

test('上游连不上时给出可读原因，而不是把原始异常抛给用户', () =>
  fixture(
    async ({ call }) => {
      globalThis.fetch = async () => {
        throw new Error('getaddrinfo ENOTFOUND api.example.invalid');
      };
      const r = await call('POST');
      assert.equal(r.http, 200, r.text);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.status, 0);
      assert.match(r.json.error, /无法连接到模型服务/);
      assert.doesNotMatch(r.text, /DO-NOT-LEAK/);
    },
    { OPENAI_API_KEY: KEY }
  ));