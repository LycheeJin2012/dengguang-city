// 守门：模型回复里混进来的 <think> 思考块必须被剥掉。
//
// 这不是假想问题。2026-10-07 拿真实的 MiniMax key 实测（api.minimax.cn）：
//   MiniMax-M3.1-Flash-Preview → 干净，content 就是纯 JSON
//   MiniMax-M3               → content 开头是 "<think>...</think>\n{...}"
// 而 model-json.js 原来只剥 ```json 围栏，不剥 <think>，于是
//   JSON.parse('<think>We need...') → Unexpected token '<'
// → 落进 catch → 对玩家显示「AI 暂不可用或返回了无效题目」
//
// 也就是说：接一个能用的模型，功能却静默地全废了。这类 bug 最贵，
// 因为它不报错、不报警，只是安静地不工作。
//
// 同时守住反向风险：剥得太狠会把「本来就没有 JSON」也当成成功。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelJson } from '../functions/_core/model-json.js';

/** 装一个假上游，返回指定的 content 原文。返回 { seen, restore } */
function fakeUpstream(content) {
  const original = globalThis.fetch;
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  return {
    seen,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const ENV = {
  OPENAI_API_KEY: 'sk-test-THINK',
  OPENAI_BASE_URL: 'https://api.minimax.cn/v1',
  OPENAI_MODEL: 'MiniMax-M3',
};

/** 实测原样：MiniMax-M3 把思考写进 content，JSON 在 think 块之后 */
const REAL_M3 = '<think>The user wants me to create a riddle.\n\nA riddle needs:\n- 面\n- 目\n- 底\n</think>\n{"谜面":"春节三日","谜目":"打一字","谜底":"人"}';

test('回复带 <think> 前缀时仍应解析成功（实测 MiniMax-M3 形状）', async (t) => {
  const up = fakeUpstream(REAL_M3);
  try {
    const out = await modelJson(ENV, 'system', { 主题: '春节' });
    assert.equal(out.谜面, '春节三日');
    assert.equal(out.谜底, '人');
  } finally {
    up.restore();
  }
});

test('<think> 与 ```json 围栏同时出现时，两个都要剥掉', async (t) => {
  const up = fakeUpstream('<think>先想想格式…</think>\n```json\n{"谜面":"中秋","谜底":"月"}\n```');
  try {
    const out = await modelJson(ENV, 'system', {});
    assert.equal(out.谜面, '中秋');
  } finally {
    up.restore();
  }
});

test('只有围栏没有 think 时行为不变（防止把既有修好路径改坏）', async (t) => {
  const up = fakeUpstream('```json\n{"谜面":"端午","谜底":"粽"}\n```');
  try {
    const out = await modelJson(ENV, 'system', {});
    assert.equal(out.谜底, '粽');
  } finally {
    up.restore();
  }
});

test('纯 JSON 不受影响', async (t) => {
  const up = fakeUpstream('{"谜面":"元宵","谜底":"圆"}');
  try {
    const out = await modelJson(ENV, 'system', {});
    assert.equal(out.谜面, '元宵');
  } finally {
    up.restore();
  }
});

test('剥掉 think 后若确实没有 JSON，仍然必须判失败（不得变成假绿灯）', async (t) => {
  const up = fakeUpstream('<think>我需要出题…但是没出。</think>');
  await assert.rejects(
    () => modelJson(ENV, 'system', {}),
    (e) => e.status === 502,
    '只有思考没有 JSON 时必须报 502，不能把空结果当成功'
  );
  up.restore();
});

test('上游 200 但 content 不是字符串时仍判失败', async (t) => {
  const up = fakeUpstream(null);
  await assert.rejects(() => modelJson(ENV, 'system', {}), (e) => e.status === 502);
  up.restore();
});