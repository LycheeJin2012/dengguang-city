// 私信「依据」链接的纯函数测试。
//
// 这段以前是 chat/index.js 顶部一行内联代码，没有测试覆盖。
// 它的输入是后端塞进消息里的 knowledge_sources —— 也就是说，
// **它处理的是不受信任的字符串**，JSON 解析失败、类型不对、
// kind 是没见过的新值，这三种情况都必须在渲染前就挡掉，
// 不能让一条坏数据把整个私信线程炸掉。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinks } from '../js/app/features/chat/sources.js';

test('已知 kind 映射到正确的站内地址', () => {
  assert.equal(
    sourceLinks(JSON.stringify([{ id: 7, kind: 'hotel', title: '树屋酒店' }])),
    '<a href="/hotel.html">依据：树屋酒店</a>'
  );
  assert.match(sourceLinks(JSON.stringify([{ id: 3, kind: 'personal', title: '事由办理' }])), /href="\/affairs\.html"/);
  assert.match(sourceLinks(JSON.stringify([{ id: 12, kind: 'place', title: '樱花公园' }])), /href="\/map\.html#place-12"/);
  assert.match(sourceLinks(JSON.stringify([{ id: 5, kind: 'knowledge', title: '入住须知' }])), /href="\/knowledge\.html\?id=5"/);
});

test('多条依据逐条换行', () => {
  const out = sourceLinks(
    JSON.stringify([
      { id: 1, kind: 'hotel', title: '树屋酒店' },
      { id: 2, kind: 'knowledge', title: '交通' },
    ])
  );
  assert.equal(out.split('<br>').length, 2);
});

test('后端塞进来的脏数据一律降级为空，不抛异常', () => {
  const bad = [
    'not json at all',
    '{"id":1}',            // 不是数组
    '[1,2,3]',             // 元素不是对象
    'null',
    '',
    undefined,
    '{"a":',
  ];
  for (const raw of bad) {
    assert.equal(sourceLinks(raw), '', `输入 ${JSON.stringify(raw)} 应降级为空串`);
  }
});

test('不认识或缺字段的条目被丢掉，已知的照常渲染', () => {
  // 未知 kind：宁可少一个入口，也不引到猜出来的地址上去
  assert.equal(sourceLinks(JSON.stringify([{ id: 1, kind: 'wormhole', title: '任意门' }])), '');
  // id 不是安全整数（比如后端拼错类型）
  assert.equal(sourceLinks(JSON.stringify([{ id: 'abc', kind: 'hotel', title: '树屋酒店' }])), '');
  assert.equal(sourceLinks(JSON.stringify([{ id: 1.5, kind: 'hotel', title: '树屋酒店' }])), '');
  // 一好一坏：只留好的那条，不能整条一起丢
  const mixed = sourceLinks(
    JSON.stringify([
      { id: 1, kind: 'wormhole', title: '任意门' },
      { id: 2, kind: 'hotel', title: '树屋酒店' },
    ])
  );
  assert.equal(mixed, '<a href="/hotel.html">依据：树屋酒店</a>');
});

test('标题里的 HTML 被转义，坏不掉 DOM', () => {
  const out = sourceLinks(
    JSON.stringify([{ id: 1, kind: 'hotel', title: '<img src=x onerror=alert(1)>' }])
  );
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});
