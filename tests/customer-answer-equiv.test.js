// _core/customer-answer.js 的行为差分守门 —— 补上 v88.7 审查里最后一块盲区。
//
// 背景：上一轮对 47 个路由 × 336 个场景跑过真 SQLite 行为差分，对 _core/ 下 23 个
// 模块用 19 组参数探测过，全部 0 差异。customer-answer.js 是覆盖最弱的一块：测试
// 环境没有 OPENAI_API_KEY，只能走 `if(!sources.length||!env.OPENAI_API_KEY)return
// fallback()` 这条兜底分支，而**主链路（真调模型）从未被行为验证过**。
//
// 这轮去压缩重写恰好把这个文件拆开了：FOLLOW_UP / HOTEL_QUERY / PLACE_QUERY /
// CONTEXT_TAIL_CHARS / MAX_QUERY_CHARS / MAX_ANSWER_CHARS / VERBATIM_SOURCE_CHARS
// 全部从内联字面量提成命名常量，hotelSources / placeSources / grounded 三个函数
// 从 smartCustomerReply 体内抽出来。抽取本身最容易出错的正是「闭包里漏传一个变量」
// 和「三个被提出来的函数各自丢了半条校验」，而这些在兜底分支上完全看不出来。
//
// 所以这里做三件事，都必须两版同时跑：
//
//   1. 拿真 SQLite 跑两版，比对**返回值 / 抛出的异常 / 全库所有表的完整快照**。
//      上一轮审查吃过「只比 HTTP 就算通过」的亏 —— 这个函数是纯读写的，返回值一样
//      但 SQL 少查了一次，风险已经变了。
//   2. 比对**逐条 SQL（带 bind 参数）**。MAX_QUERY_CHARS 这类截断不会出现在返回值里，
//      也不会出现在发出去的模型输入里（模型收到的是原 question，不是截断后的 query），
//      只有 searchKnowledge 的 LIKE 参数会变 —— 少了这一条，截断被删掉测试照样全绿。
//   3. 比对**发出去的那次模型请求**（含逐字的 system prompt 与 source 列表），
//      并顺手把 system prompt 钉住：约束是「不改任何中文文案」。
//
// 基线从 git 动态提取，不在磁盘上留副本目录。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { database } from './local-d1.mjs';
import { ensureDatabase } from '../functions/_core/database.js';

const BASELINE = '06e9595';
const TARGET = 'functions/_core/customer-answer.js';

const show = (path) =>
  execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8', maxBuffer: 1 << 28 });

// ---------------------------------------------------------------------------
// 基线副本的落盘
//
// 副本必须待在 functions/_core/ 下，它内部的 './knowledge.js' 相对 import 才成立。
// 文件名必须与原模块不同：ESM 按绝对路径缓存，同名会让两版拿到同一个模块对象，
// 差分直接白做。清理时**只认本进程登记过的路径**，不扫全仓库。
// ---------------------------------------------------------------------------

const ownedTmpFiles = new Set();
let tmpSeq = 0;

async function loadBoth() {
  const name = `.equiv-${process.pid}-${++tmpSeq}-customer-answer.mjs`;
  const rel = 'functions/_core/' + name;
  // writeFileSync 相对 cwd（仓库根）；import() 相对本文件（tests/），所以加 '../'
  writeFileSync(rel, show(TARGET));
  ownedTmpFiles.add(rel);
  const oldM = await import('../' + rel);
  const newM = await import('../' + TARGET);
  return {
    oldM,
    newM,
    cleanup: () => {
      try { unlinkSync(rel); } catch {}
      ownedTmpFiles.delete(rel);
    },
  };
}

function cleanupTmpFiles() {
  for (const f of ownedTmpFiles) {
    try { unlinkSync(f); } catch {}
  }
  ownedTmpFiles.clear();
}
// 这里只清临时副本，不碰数据库 —— 见下面 seeded() 的注释。
process.on('exit', cleanupTmpFiles);

// ---------------------------------------------------------------------------
// 代理 DB：逐条记录 SQL 文本 + bind 参数
//
// 为什么要记 params：截断类改动（MAX_QUERY_CHARS / CONTEXT_TAIL_CHARS）不改 SQL
// 文本，只改绑定进去的 LIKE 模式。只比 SQL 字符串的话，把 .slice(-1500) 整段删掉
// 都测不出来。坑：Statement.first() 内部会调 all()，所以要包一层而不是直接透传，
// 否则一次 first() 会被记成两条，序列比对凭空多一项。
// ---------------------------------------------------------------------------
const normSql = (s) => String(s).replace(/\s+/g, ' ').trim();

function traceDb(DB, log) {
  const wrap = (st) => ({
    sql: st.sql,
    params: st.params,
    bind: (...p) => wrap(st.bind(...p)),
    all: () => { log.push({ sql: normSql(st.sql), params: st.params }); return st.all(); },
    run: () => { log.push({ sql: normSql(st.sql), params: st.params }); return st.run(); },
    first: (c) => { log.push({ sql: normSql(st.sql), params: st.params }); return st.first(c); },
  });
  return { prepare: (sql) => wrap(DB.prepare(sql)), batch: (items) => DB.batch(items) };
}

/**
 * 建一份全新的真库。
 *
 * close() 幂等，且每条用例都必须在 finally 里显式调它：database() 会 fork 一个
 * python3 SQLite 子进程，子进程不退 node 就不退，test runner 永远等不到结束。
 * 只挂 process.on('exit') 兜底是没用的 —— 那个钩子要等进程即将退出才跑，而恰恰是
 * 这些活着的子进程阻止了退出，死锁。也不用 process.exit（会吞掉 TAP 输出）。
 */
async function seeded() {
  const DB = database();
  await ensureDatabase(DB);
  const log = [];
  let closed = false;

  // 全部显式写死时间戳：库里大量列的默认值是 datetime('now')，两版各建一份库，
  // INSERT 时刻差几秒就会让全库快照对不上 —— 那种「差异」是假差异。
  const T = '2026-01-01 00:00:00';

  await DB.prepare(
    "INSERT INTO players(id,username,email,password_hash,salt,status,emeralds,created_at) VALUES(1,'citizen','c1@example.invalid','x','x','active',1000,?)"
  ).bind(T).run();
  await DB.prepare("INSERT INTO admins(id,username,role,password_hash,salt) VALUES(1,'super','super','x','x')").run();

  // 知识库。source_kind='manual' 时 knowledge.js 的 fresh() 直接返回 true，
  // 省掉构造 source_hash 的麻烦。
  // 条数是刻意堆的：1/5/6/7 四条都能被「东门施工什么时候恢复」检索到，
  // 于是 searchKnowledge 的 limit=4 与「只取前 N 条」这类改动都能被数出来 ——
  // 只放一条的话，limit 4 改成 2 结果一模一样，测试就是假绿。
  // 8 号是 source_kind='announcement' 但 source_hash 对不上（过期来源），
  // 必须被 fresh() 剔掉；它要是混进模型输入，来源条数就变了。
  const articles = [
    [1, '东门施工公告说明', '东门施工什么时候结束', SHORT_SOURCE, '施工 进度 公告 恢复', 'public', 'published', 'manual'],
    [2, '树上酒店预订规则', '树上酒店怎么预订', '树上酒店位于中央广场北侧，预订需在个人中心提交入住与退房日期，房型与价格以预订页显示为准。', '酒店 预订 房型 住宿 客房', 'public', 'published', 'manual'],
    [3, '驾照考试内部资料', '驾照考试通过标准', '驾照考试内部通过标准仅供后台使用。', '驾照 考试', 'exam', 'published', 'manual'],
    [4, '未审核的草稿资料', '草稿施工说明', '草稿状态的施工说明不应被检索到。', '施工 草稿', 'public', 'draft', 'manual'],
    [5, '东门施工补充说明一', '东门施工什么时候结束', '东门施工预计在既定日期前完成，属于预计而非承诺，恢复前请留意最新公告。', '东门 施工 进度 公告', 'public', 'published', 'manual'],
    [6, '东门施工补充说明二', '东门施工什么时候完成', '东门施工的第二份补充说明，日期同样是预计而非承诺。', '东门 施工 进度 公告', 'public', 'published', 'manual'],
    [7, '东门施工补充说明三', '东门施工什么时候开工', '东门施工的第三份补充说明，绕行方案见公告正文。', '东门 施工 进度 公告', 'public', 'published', 'manual'],
    [8, '东门施工过期说明', '东门施工什么时候结束', '东门施工的过期说明，来源已被改动，应当被判定为不再新鲜。', '东门 施工 进度 公告', 'public', 'published', 'announcement'],
  ];
  for (const [id, title, question, answer, keywords, audience, status, kind] of articles) {
    await DB.prepare(
      'INSERT INTO knowledge_articles(id,title,question,answer,keywords,audience,status,source_kind,source_id,source_hash,revision,created_by,reviewed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, title, question, answer, keywords, audience, status, kind, kind === 'manual' ? null : 1, kind === 'manual' ? null : 'deadbeef', 1, 1, 1, T, T).run();
  }

  await DB.prepare(
    'INSERT INTO announcements(id,title,content,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)'
  ).bind(1, '东门施工维护通知', '东门施工预计于本月末恢复，恢复前请注意绕行。', 1, T, T).run();
  await DB.prepare(
    'INSERT INTO announcements(id,title,content,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)'
  ).bind(2, '广场嘉年华预告', '本周六中央广场举办嘉年华活动，欢迎参加。', 1, T, T).run();

  // 酒店：4 家在营、1 家停业（is_active=0 必须被 WHERE 挡掉）。
  // 4 家在营是刻意的：每家都能蹭到 query 里的「酒店」二字、相似度过 0.1，
  // 于是 slice(0,3) 的上限是真的会被触碰到的，改成 2 就看得出来。
  const hotels = [
    [1, '树上酒店', '中央广场北侧', '树屋风格 hotel room with balcony', 1],
    [2, '灯塔客栈', '东门车站旁', '靠近车站的客栈', 1],
    [3, '已停业旅店', '旧城区', '停业旅店不应出现', 0],
    [4, '河边旅馆', '旧城区河边', '临河的旧式旅馆', 1],
    [5, '广场旅舍', '中央广场东侧', '简朴旅舍', 1],
  ];
  for (const [id, name, address, description, active] of hotels) {
    await DB.prepare(
      'INSERT INTO hotels(id,name,address,description,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
    ).bind(id, name, address, description, active, T, T).run();
  }

  // 地点：3 条合格、1 条未发布、1 条非主世界维度 —— published 与 dimension='overworld'
  // 两个条件缺一不可，少一个那条地点就会混进模型输入。
  // 3 条合格同样是刻意的：slice(0,5) 的上限才会被触碰。
  const places = [
    [1, '东门', 'road', 'overworld', 100, 200, '东门连接中央大道与旧城区', 'closed', '东门正在施工，预计月末恢复', '2026-01-31', 1],
    [2, '未发布地点', 'road', 'overworld', 1, 1, '未发布不应出现', 'open', '', '', 0],
    [3, '下界传送门', 'portal', 'nether', 1, 1, '非主世界维度不应出现', 'open', '', '', 1],
    [4, '东门北段', 'road', 'overworld', 110, 210, '东门北段连接旧城区', 'closed', '北段施工中', '2026-02-10', 1],
    [5, '西门辅路', 'road', 'overworld', 90, 190, '西门道路连接车站', 'closed', '西门施工中', '2026-02-20', 1],
  ];
  for (const [id, name, category, dimension, x, z, description, status, note, end, published] of places) {
    await DB.prepare(
      'INSERT INTO city_places(id,name,category,dimension,x,z,description,construction_status,construction_note,expected_end,published,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, name, category, dimension, x, z, description, status, note, end, published, 1, 1, T).run();
  }

  // 玩家自己的事务，供 personal 分支与 personal 兜底
  await DB.prepare(
    "INSERT INTO tickets(id,player_id,category,source_table,title,body,status,admin_reply,replied_at,created_at,updated_at) VALUES(1,1,'appeal',NULL,'路灯损坏申请','路灯不亮','resolved','已安排维修',?,?,?)"
  ).bind(T, T, T).run();
  await DB.prepare(
    "INSERT INTO bookings(id,player_id,room_id,room_name,in_date,out_date,nights,status,name,contact,created_at) VALUES(1,1,'1','大床房','2099-01-01','2099-01-03',2,'confirmed','citizen','13800000000',?)"
  ).bind(T).run();
  await DB.prepare(
    "INSERT INTO notification_log(id,player_id,type,title,body,read_at,created_at) VALUES(1,1,'system','事务更新','有一条新进展',NULL,?)"
  ).bind(T).run();

  return {
    DB,
    log,
    env: { DB: traceDb(DB, log), OPENAI_API_KEY: 'mock-key' },
    close: () => {
      if (closed) return;
      closed = true;
      try { DB.close(); } catch {}
    },
  };
}

/**
 * 全库快照：所有表的所有行。
 *
 * 排除 lc_schema_versions：它的 applied_at 默认 CURRENT_TIMESTAMP，两版各建一次库
 * 必然差几秒，是假差异；改成只比 version 号，schema 是否真的建齐照样能查出来。
 * 行在 JS 里按 JSON 排序而不是靠 SQL ORDER BY —— 免得碰上 WITHOUT ROWID 表和
 * 混合类型排序的坑。
 */
async function snapshotAll(DB) {
  const names = (await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all()).results.map((r) => r.name);
  const snap = {};
  for (const name of names) {
    if (name === 'lc_schema_versions') continue;
    const rows = (await DB.prepare(`SELECT * FROM "${name}"`).all()).results;
    snap[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  snap.__schema_versions__ = (await DB.prepare('SELECT version FROM lc_schema_versions ORDER BY version').all())
    .results.map((r) => r.version);
  return snap;
}

// ---------------------------------------------------------------------------
// 模型桩
//
// smartCustomerReply → modelJson → fetch(base + '/chat/completions', {body})，
// body.messages[1].content 是 JSON.stringify({question, context, sources})。
// 期望的返回形状是 Chat Completions：{choices:[{message:{content:'<json 文本>'}}]}，
// 由 modelJson 剥 ```json 围栏后 JSON.parse，再交 grounded() 校验。
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_INNER = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/**
 * personal 来源的 content 里带 as_of=new Date().toISOString()，两次运行必然不同。
 * 麻烦的是它不是独立的字符串叶子，而是**嵌在 content 这段 JSON 文本里**的，
 * 所以要连字符串内部的 ISO 片段一起抹掉，否则差分测试每次都假失败。
 */
function normalize(value) {
  if (typeof value === 'string') return ISO.test(value) ? '<ISO时间>' : value.replace(ISO_INNER, '<ISO时间>');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalize(value[k]);
    return out;
  }
  return value;
}

/** 按场景产出模型回复；keys 为 undefined 时自动引用喂进去的第一条来源 */
function modelFor(sc, input) {
  // 'verbatim'：整段照抄第一条来源，用来踩 VERBATIM_SOURCE_CHARS=80 那道闸
  const text = sc.model === 'verbatim' ? input.sources[0].content : sc.answer;
  const keys = sc.keys === undefined ? [input.sources[0]?.key] : sc.keys;
  return { needs_human: sc.needsHuman === true, answer: text, source_keys: keys };
}

/** 返回一个可记录请求的 fetch 桩 */
function stubFetch(sc) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    const input = JSON.parse(body.messages[1].content);
    calls.push({ url: String(url), system: body.messages[0].content, input: normalize(input) });
    switch (sc.model) {
      case 'throw': throw new Error('model timeout');
      case 'http500': return new Response('boom', { status: 500 });
      case 'garbage': return Response.json({ choices: [{ message: { content: '这不是 JSON' } }] });
      case 'fenced':
        return Response.json({
          choices: [{ message: { content: '```json\n' + JSON.stringify(modelFor(sc, input)) + '\n```' } }],
        });
      case 'oversize':
        return Response.json({ choices: [{ message: { content: 'x'.repeat(20001) } }] });
      case 'null':
        return Response.json({ choices: [{ message: { content: 'null' } }] });
      case 'ok':
      case 'verbatim':
        return Response.json({ choices: [{ message: { content: JSON.stringify(modelFor(sc, input)) } }] });
      default: throw new Error('未知模型场景 ' + sc.model);
    }
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------
// 场景序列
//
// 两版跑**完全相同**的、有序的输入序列（同一份库、同样的调用顺序），逐场景对比。
// 每条都标了踩的是哪个常量 / 哪条 SQL。
// ---------------------------------------------------------------------------

const LONG_HEAD = '施工什么时候结束';            // 只会出现在超长问题的开头
const Y = 'Y'.repeat(1000);
const PREV_TAIL = '酒店预订入住时间是几点';          // 只会出现在上一轮原话的结尾
// 上一轮原话长 Y.length + PREV_TAIL.length > 600，slice(-600) 之后留下
// PREV_TAIL.length 个汉字 + 若干个 y。那个 y 的个数把 CONTEXT_TAIL_CHARS 钉死了。
const KEPT_Y = 600 - PREV_TAIL.length;
// knowledge id=1 的 answer 只有 44 字，低于 VERBATIM_SOURCE_CHARS=80
const SHORT_SOURCE = '东门路段施工属于预计日期而非承诺，恢复时间以最新公告为准，施工期间请绕行中央大道。';

const PLAYER = { id: 1, emeralds: 1000 };
const SELF_Q = '我的工单进度';

const SCENARIOS = [
  // --- 主链路：真调模型 ---
  {
    label: '成功路径：模型答复通过 grounded 三关校验 → grounded_ai',
    model: 'ok',
    question: '东门施工什么时候恢复',
    answer: '已核对公告与施工资料，恢复时间请以最新公告为准。',
  },
  {
    label: '成功路径：模型被 ```json 围栏包住也能解析（modelJson 剥围栏）',
    model: 'fenced',
    question: '东门施工什么时候恢复',
    answer: '已核对公告，恢复时间以最新公告为准。',
  },
  {
    label: '引用多条来源：source_keys 顺序不影响取用集合',
    model: 'ok',
    question: '东门施工什么时候恢复',
    keys: ['nope', 'x'],   // 第一个 key 不存在 → 必须退回兜底
    answer: '已核对公告。',
  },

  // --- AI 侧各种异常 ---
  { label: 'AI 超时（fetch 抛错）→ 兜底', model: 'throw', question: '东门施工什么时候恢复' },
  { label: 'AI 返回 HTTP 500 → 兜底', model: 'http500', question: '东门施工什么时候恢复' },
  { label: 'AI 返回垃圾文本（非 JSON）→ 兜底', model: 'garbage', question: '东门施工什么时候恢复' },
  { label: 'AI 返回 null → 兜底', model: 'null', question: '东门施工什么时候恢复' },
  { label: 'AI 输出超 20000 字 → 兜底', model: 'oversize', question: '东门施工什么时候恢复' },

  // --- grounded() 的每一道闸 ---
  {
    label: 'needs_human=true → 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '需要人工核实。', needsHuman: true,
  },
  {
    label: '整段照抄来源（content ≥ 80 字）→ 兜底',
    model: 'verbatim', question: '东门施工什么时候恢复',
  },
  {
    // knowledge:1 的 content 只有 44 字，低于 VERBATIM_SOURCE_CHARS=80，
    // 照抄它不算复读，必须放行 —— 这个边界锁的是「80」这个数字本身
    label: '整段照抄短来源（44 字 < 80）不算复读 → 放行',
    model: 'ok', question: '东门施工什么时候恢复',
    keys: ['knowledge:1'], answer: SHORT_SOURCE,
  },
  {
    label: '答案里编造数字（来源里没有 9999）→ 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '当前价格为 9999 绿宝石。',
  },
  {
    label: '答案超过 1500 字（MAX_ANSWER_CHARS）→ 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '答'.repeat(1600),
  },
  {
    label: '答案只有空白 → 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '   ',
  },
  {
    label: 'source_keys 为空数组 → 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '已核对。', keys: [],
  },
  {
    label: '引用不存在的 key（knowledge:9999）→ 兜底',
    model: 'ok', question: '东门施工什么时候恢复',
    answer: '已核对。', keys: ['knowledge:9999'],
  },

  // --- FOLLOW_UP + CONTEXT_TAIL_CHARS + MAX_QUERY_CHARS ---
  {
    // 上一轮原话长 1000 个 Y + 中文尾巴，question 以「那」开头命中 FOLLOW_UP
    label: 'FOLLOW_UP 追问：拼上上一轮原话，只取尾部 600 字（CONTEXT_TAIL_CHARS）',
    model: 'ok',
    question: '那什么时候入住',
    context: [
      { role: 'user', content: Y + PREV_TAIL },
      { role: 'assistant', content: '好的。' },
      { role: 'user', content: '那什么时候入住' },   // 与 question 相同，必须被过滤掉
    ],
    answer: '入住时间请以预订页显示为准。',
  },
  {
    label: '非追问开头（不以 FOLLOW_UP 词开头）→ 不拼接上一轮原话',
    model: 'ok',
    question: '什么时候入住',
    context: [{ role: 'user', content: Y + PREV_TAIL }, { role: 'user', content: '什么时候入住' }],
    answer: '入住时间请以预订页显示为准。',
  },
  {
    label: '追问但上一轮不存在 → 不拼接',
    model: 'ok',
    question: '那什么时候入住',
    context: [],
    answer: '入住时间请以预订页显示为准。',
  },
  {
    // 关键字只放在超长问题的开头，slice(-1500) 之后必然被切掉
    label: 'MAX_QUERY_CHARS 1500 截断：问题开头的检索词被切掉 → 检索为空',
    model: 'ok',
    question: LONG_HEAD + 'X'.repeat(3000),
    answer: '已核对。',
  },
  {
    label: 'MAX_QUERY_CHARS 边界：1500 字刚好保留检索词',
    model: 'ok',
    question: LONG_HEAD + 'X'.repeat(1500 - LONG_HEAD.length),
    answer: '已核对。',
  },
  {
    label: 'MAX_QUERY_CHARS 边界：1501 字把检索词的头一个字切掉',
    model: 'ok',
    question: LONG_HEAD + 'X'.repeat(1501 - LONG_HEAD.length),
    answer: '已核对。',
  },

  // --- HOTEL_QUERY 分支 ---
  {
    label: 'HOTEL_QUERY：问题含「酒店」→ 酒店来源进模型，且只给在营的（is_active=1）',
    model: 'ok',
    question: '树上酒店房型预订',
    answer: '房型与价格以预订页显示为准。',
  },
  {
    label: 'HOTEL_QUERY：问题含「住宿」',
    model: 'ok', question: '灯塔客栈住宿条件', answer: '住宿条件以页面显示为准。',
  },
  {
    label: '非酒店问题 → 不查 hotels',
    model: 'ok', question: '东门施工什么时候恢复', answer: '已核对。',
  },

  // --- PLACE_QUERY 分支 ---
  {
    label: 'PLACE_QUERY：问题含「施工」→ 地点来源进模型，且只给 published + overworld',
    model: 'ok', question: '东门施工进度', answer: '施工进度以公告为准。',
  },
  {
    label: 'PLACE_QUERY：问题含「地图」',
    model: 'ok', question: '地图上东门在哪里', answer: '东门在中央大道东侧。',
  },
  {
    label: '非地图类问题 → 不查 city_places',
    model: 'ok', question: '东门施工什么时候恢复', answer: '已核对。',
  },

  // --- personal 分支与兜底 ---
  {
    label: '个人事务问题 → personal 来源进模型',
    model: 'ok', question: SELF_Q, player: PLAYER, answer: '你的工单已办结。',
  },
  {
    label: '个人事务 + AI 超时 → personal 兜底文本',
    model: 'throw', question: SELF_Q, player: PLAYER,
  },
  {
    label: '无来源且无 personal → 返回 null，压根不调模型',
    model: 'ok', question: 'ZZQQ完全不相关的词', player: null,
  },
  {
    label: '没配 OPENAI_API_KEY → 直接走 personal 兜底，不调模型',
    model: 'ok', question: SELF_Q, player: PLAYER, noKey: true,
  },
  {
    label: '没配 key 且无 personal → null',
    model: 'ok', question: '东门施工什么时候恢复', player: null, noKey: true,
  },
  {
    label: 'player 为 null 但问题命中个人口径 → 不带 personal 来源',
    model: 'ok', question: SELF_Q, player: null,
  },
];

// ---------------------------------------------------------------------------
// 逐场景执行
// ---------------------------------------------------------------------------

async function runScenario(mod, f, sc) {
  const prevFetch = globalThis.fetch;
  const env = sc.noKey ? { DB: f.env.DB } : f.env;
  const { impl, calls } = stubFetch(sc);
  globalThis.fetch = impl;
  const before = f.log.length;
  let out;
  try {
    const result = await mod.smartCustomerReply(env, sc.question, sc.context ?? [], sc.player ?? null);
    out = { ok: true, result: normalize(result) };
  } catch (e) {
    out = { ok: false, throw: e.message };
  } finally {
    globalThis.fetch = prevFetch;
  }
  return {
    label: sc.label,
    outcome: out,
    calls,
    sql: f.log.slice(before),
  };
}

/** 把一次完整运行的结果收成可比对的对象 */
async function runAll(mod) {
  const f = await seeded();
  try {
    const results = [];
    for (const sc of SCENARIOS) {
      const r = await runScenario(mod, f, sc);
      // verbatim 场景的 answer 依赖现场 sources，挂到桩上重跑一次取值
      if (sc.model === 'verbatim') r.answerUsed = r.calls.at(-1)?.input?.sources?.[0]?.content?.length ?? null;
      results.push(r);
    }
    return { results, snap: await snapshotAll(f.DB) };
  } finally {
    f.close();
  }
}

/** 首个不同的叶子路径 + 截断后的两值，用来把差异说人话 */
const isObj = (v) => v !== null && typeof v === 'object';
const brief = (v) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
};

function firstDiff(a, b, path = '') {
  if (Object.is(a, b)) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return `${path || '<root>'}: 类型 ${ta} ≠ ${tb}`;
  // 数组和对象都要往下递归 —— 只比长度不够，得逐个元素比
  if (!isObj(a)) return `${path || '<root>'}: ${brief(a)} ≠ ${brief(b)}`;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}: 新版多出 ${brief(b[k])}`;
    if (!(k in b)) return `${path}.${k}: 新版缺少 ${brief(a[k])}`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test(`customer-answer：${SCENARIOS.length} 组场景在真库上逐场景行为一致（返回值/异常/SQL/模型请求）`, async () => {
  const { oldM, newM, cleanup } = await loadBoth();
  try {
    const a = await runAll(oldM);
    const b = await runAll(newM);

    assert.equal(b.results.length, a.results.length, '场景条数必须一致');
    const diffs = [];
    for (let i = 0; i < a.results.length; i++) {
      const ra = a.results[i];
      const rb = b.results[i];
      assert.equal(rb.label, ra.label, `第 ${i} 条场景顺序不一致`);
      for (const field of ['outcome', 'calls', 'sql', 'answerUsed']) {
        const d = firstDiff(rb[field], ra[field], `${ra.label}.${field}`);
        if (d) diffs.push(d);
      }
    }
    assert.deepEqual(diffs, [], diffs.join('\n'));

    // 防假绿：只比「两边一样」不够，必须证明主链路真的被走到了。
    // 注意 AI 异常类场景用的是**非个人口径**的问题且不带 player，
    // 所以它们的兜底是 null 而不是 personal 文本 —— 返回 null 的场景本来就多。
    const stats = {
      场景数: a.results.length,
      模型调用次数: a.results.reduce((n, r) => n + r.calls.length, 0),
      成功答复: a.results.filter((r) => r.outcome.ok && r.outcome.result?.source === 'grounded_ai').length,
      人工兜底: a.results.filter((r) => r.outcome.ok && r.outcome.result?.source === 'personal_records').length,
      返回null: a.results.filter((r) => r.outcome.ok && r.outcome.result === null).length,
      SQL条数: a.results.reduce((n, r) => n + r.sql.length, 0),
    };
    assert.ok(stats.模型调用次数 >= 20, `模型只被调了 ${stats.模型调用次数} 次，主链路没覆盖到：${JSON.stringify(stats)}`);
    assert.ok(stats.成功答复 >= 12, `grounded_ai 只有 ${stats.成功答复} 次，三关校验没覆盖全：${JSON.stringify(stats)}`);
    assert.ok(stats.人工兜底 >= 2, `personal 兜底只有 ${stats.人工兜底} 次：${JSON.stringify(stats)}`);
    assert.ok(stats.返回null >= 8, `返回 null 只有 ${stats.返回null} 次：${JSON.stringify(stats)}`);
    assert.ok(stats.SQL条数 >= 100, `只发了 ${stats.SQL条数} 条 SQL，fixture 很可能没建起来：${JSON.stringify(stats)}`);
    // 每一类来源都得真的进过模型输入，否则下面的分支断言是在空气上跑的
    const kinds = new Set(a.results.flatMap((r) => r.calls.flatMap((c) => c.input.sources.map((s) => s.key.split(':')[0]))));
    for (const kind of ['knowledge', 'announcement', 'hotel', 'place', 'personal']) {
      assert.ok(kinds.has(kind), `没有场景把 ${kind} 来源喂进过模型：实际 ${JSON.stringify([...kinds])}`);
    }
  } finally {
    cleanup();
  }
});

test('customer-answer：两版跑完之后全库快照逐表逐行一致（没有多写少写）', async () => {
  const { oldM, newM, cleanup } = await loadBoth();
  try {
    const a = await runAll(oldM);
    const b = await runAll(newM);
    const d = firstDiff(b.snap, a.snap, '全库快照');
    assert.equal(d, null, d || '');
    // 防假绿：快照里必须真的有数据，比两个空库等于没比
    const rows = Object.entries(a.snap).filter(([k]) => !k.startsWith('__'));
    assert.ok(rows.some(([, v]) => v.length > 0), '快照全空 —— fixture 没建起来');
    assert.ok(a.snap.knowledge_articles.length >= 4, `知识库只有 ${a.snap.knowledge_articles.length} 条`);
    assert.ok(a.snap.hotels.length >= 3, `酒店只有 ${a.snap.hotels.length} 条`);
    assert.ok(a.snap.city_places.length >= 3, `地点只有 ${a.snap.city_places.length} 条`);
  } finally {
    cleanup();
  }
});

test('customer-answer：SYSTEM_PROMPT 逐字未改（约束：中文文案一个字都不能动）', async () => {
  const { oldM, newM, cleanup } = await loadBoth();
  try {
    const systems = [];
    for (const mod of [oldM, newM]) {
      const f = await seeded();
      try {
        const prev = globalThis.fetch;
        const { impl, calls } = stubFetch({ model: 'ok', question: '东门施工什么时候恢复', answer: '已核对。' });
        globalThis.fetch = impl;
        try {
          await mod.smartCustomerReply(f.env, '东门施工什么时候恢复', [], null);
        } finally {
          globalThis.fetch = prev;
        }
        systems.push(calls[0].system);
      } finally {
        f.close();
      }
    }
    const [a, b] = systems;
    assert.equal(b.length, a.length, `system prompt 长度变了：原 ${a.length} / 新 ${b.length}`);
    assert.equal(
      createHash('sha256').update(b).digest('hex'),
      createHash('sha256').update(a).digest('hex'),
      'system prompt 被改了'
    );
    // 钉住三句关键约束，删任何一条都算改行为
    for (const phrase of ['你是灯光市玩家个人助手灯灯', '网站绿宝石余额与游戏背包不相同', '施工日期是预计而非承诺', '资料不足或不能回答当前问题返回']) {
      assert.ok(a.includes(phrase), `基线 system prompt 缺少关键约束：${phrase}`);
      assert.ok(b.includes(phrase), `新版 system prompt 缺少关键约束：${phrase}`);
    }
  } finally {
    cleanup();
  }
});

test('customer-answer：MAX_QUERY_CHARS=1500 的截断仍在生效', async () => {
  const { newM, cleanup } = await loadBoth();
  try {
    const f = await seeded();
    try {
      // 检索词只在问题开头；一旦不截断，knowledge id=1 就会被检索到并触发模型调用
      const run = async (question) => {
        const prev = globalThis.fetch;
        const { impl, calls } = stubFetch({ model: 'ok', answer: '已核对。' });
        globalThis.fetch = impl;
        const before = f.log.length;
        let result;
        try {
          result = await newM.smartCustomerReply(f.env, question, [], null);
        } finally {
          globalThis.fetch = prev;
        }
        return { calls, sql: f.log.slice(before), result };
      };

      const long = await run(LONG_HEAD + 'X'.repeat(3000));
      assert.equal(long.result, null, '截断后不该再检索到开头那条知识');
      assert.equal(long.calls.length, 0, '截断后不该调模型');
      // LIKE 参数里必须是被切掉后剩下的 1500 个 x，开头的「施工」二元组不该出现
      const like = long.sql.flatMap((s) => s.params).filter((p) => typeof p === 'string' && p.startsWith('%x'));
      assert.ok(like.length > 0, '应当仍发出过 x 的 LIKE 粗筛');
      assert.ok(
        like.every((p) => p === '%' + 'x'.repeat(1500) + '%'),
        `截断后 x 的 LIKE 应当正好 1500 个，实际长度 ${like.map((p) => p.length - 2)}`
      );
      assert.ok(
        long.sql.flatMap((s) => s.params).every((p) => p !== '%施工%' && p !== '%工施%'),
        '开头那两个二元组不该出现在 LIKE 参数里'
      );

      // 边界：检索词放在问题**开头**、后面接填充字，溢出的部分才会被切到头上。
      // （反过来把填充字放前面是没用的 —— slice(-1500) 取的是末尾窗口，
      //   多出来的前导字本来就落在窗口外，两种写法算出来的 query 完全一样。）
      const xLen = (r) => r.sql.flatMap((s) => s.params)
        .filter((p) => typeof p === 'string' && p.startsWith('%x'))
        .map((p) => p.length - 2);
      const at1500 = LONG_HEAD + 'X'.repeat(1500 - LONG_HEAD.length);
      const edge = await run(at1500);
      assert.equal(edge.result !== null || edge.calls.length > 0, true);
      assert.equal(edge.calls.length, 1, '恰好 1500 字时检索词还在，必须能检索到并调模型');
      assert.deepEqual(xLen(edge), [1500 - LONG_HEAD.length], '1500 字时 x 的粗筛长度不对');
      assert.ok(
        edge.sql.flatMap((s) => s.params).includes('%施工%'),
        '1500 字时「施工」二元组应还在 LIKE 参数里'
      );
      const sent = edge.calls[0].input.sources.map((s) => s.key);
      assert.ok(sent.includes('knowledge:1'), `恰好 1500 字时应命中 knowledge:1，实际来源 ${JSON.stringify(sent)}`);

      // 1501 字：窗口正好把「施工」的头一个字切掉。
      // 注意这只影响 **LIKE 参数**（'%施工%' 消失），检索结果本身不变 ——
      // 「工什/么时/时候/候结/结束」这五个二元组照样全部命中同一条资料，相似度仍然很高。
      // 所以这条边界只能从 SQL 参数上钉，钉在结果上就变成假绿。
      const at1501 = LONG_HEAD + 'X'.repeat(1501 - LONG_HEAD.length);
      const over = await run(at1501);
      assert.ok(
        !over.sql.flatMap((s) => s.params).includes('%施工%'),
        '1501 字时「施工」二元组必须被切掉 —— MAX_QUERY_CHARS 失效了'
      );
      assert.deepEqual(xLen(over), [1501 - LONG_HEAD.length], '1501 字时被切掉的是 1 个汉字，x 应当全留下');
      assert.ok(
        over.sql.flatMap((s) => s.params).includes('%工什%'),
        '「工什」这个二元组在 1501 字时仍应存在 —— 证明只切掉了一个字'
      );
    } finally {
      f.close();
    }
  } finally {
    cleanup();
  }
});

test('customer-answer：CONTEXT_TAIL_CHARS=600 只取上一轮原话的尾部 600 字', async () => {
  const { newM, cleanup } = await loadBoth();
  try {
    const f = await seeded();
    try {
      const run = async (question, context) => {
        const prev = globalThis.fetch;
        const { impl, calls } = stubFetch({ model: 'ok', answer: '已核对。' });
        globalThis.fetch = impl;
        const before = f.log.length;
        let result;
        try {
          result = await newM.smartCustomerReply(f.env, question, context, null);
        } finally {
          globalThis.fetch = prev;
        }
        return { calls, sql: f.log.slice(before), result };
      };

      const follow = await run('那什么时候入住', [
        { role: 'user', content: Y + PREV_TAIL },
        { role: 'user', content: '那什么时候入住' },
      ]);
      const params = follow.sql.flatMap((s) => s.params).filter((p) => typeof p === 'string');
      // 尾部 600 字里恰好留下 KEPT_Y 个 y —— y 的个数把 CONTEXT_TAIL_CHARS 钉死了
      assert.ok(
        params.includes('%' + 'y'.repeat(KEPT_Y) + '%'),
        `上一轮原话应只保留尾部 ${KEPT_Y} 个 y，实际 LIKE 参数 ${JSON.stringify(params.filter((p) => /^%y+$/.test(p)))}`
      );
      assert.ok(
        !params.some((p) => /^%y+$/.test(p) && p.length > KEPT_Y + 2),
        '保留了比 600 字更多的 y —— CONTEXT_TAIL_CHARS 没生效'
      );
      assert.ok(params.includes('%几点%'), '上一轮原话的尾部中文应参与检索');
      assert.ok(params.includes('%入住%'), '本轮问题应参与检索');

      const notFollow = await run('什么时候入住', [
        { role: 'user', content: Y + PREV_TAIL },
        { role: 'user', content: '什么时候入住' },
      ]);
      const nparams = notFollow.sql.flatMap((s) => s.params).filter((p) => typeof p === 'string');
      assert.ok(
        !nparams.some((p) => /^%y+$/.test(p)),
        '非追问开头时不该拼接上一轮原话 —— FOLLOW_UP 判定被改坏了'
      );
    } finally {
      f.close();
    }
  } finally {
    cleanup();
  }
});

test('customer-answer：HOTEL_QUERY / PLACE_QUERY 两条分支的 SQL 条件与来源构成', async () => {
  const { newM, cleanup } = await loadBoth();
  try {
    const f = await seeded();
    try {
      const run = async (question) => {
        const prev = globalThis.fetch;
        const { impl, calls } = stubFetch({ model: 'ok', answer: '已核对。' });
        globalThis.fetch = impl;
        const before = f.log.length;
        try {
          await newM.smartCustomerReply(f.env, question, [], null);
        } finally {
          globalThis.fetch = prev;
        }
        return { calls, sql: f.log.slice(before) };
      };

      const hotel = await run('树上酒店房型预订');
      const hotelSql = hotel.sql.filter((s) => s.sql.includes('FROM hotels'));
      assert.equal(hotelSql.length, 1, '问酒店时应恰好查一次 hotels');
      assert.ok(hotelSql[0].sql.includes('is_active=1'), `is_active=1 条件丢了：${hotelSql[0].sql}`);
      const hotelKeys = hotel.calls[0].input.sources.map((s) => s.key);
      assert.ok(hotelKeys.some((k) => k.startsWith('hotel:')), `应带酒店来源：${JSON.stringify(hotelKeys)}`);
      assert.ok(!hotelKeys.includes('hotel:3'), '停业酒店（id=3）不该进模型输入');
      // 4 家在营都过得了 0.1 门槛，所以上限 3 是真的被触碰到了
      const hotelCount = hotelKeys.filter((k) => k.startsWith('hotel:')).length;
      assert.equal(hotelCount, 3, `酒店来源应当恰好 3 条，实际 ${hotelCount}：${JSON.stringify(hotelKeys)}`);

      const noHotel = await run('东门施工什么时候恢复');
      assert.equal(noHotel.sql.filter((s) => s.sql.includes('FROM hotels')).length, 0, '不涉及酒店时不该查 hotels');

      const place = await run('东门施工进度');
      const placeSql = place.sql.filter((s) => s.sql.includes('FROM city_places'));
      assert.equal(placeSql.length, 1, '问地点时应恰好查一次 city_places');
      assert.ok(placeSql[0].sql.includes('published=1'), `published=1 条件丢了：${placeSql[0].sql}`);
      assert.ok(placeSql[0].sql.includes("dimension='overworld'"), `dimension='overworld' 条件丢了：${placeSql[0].sql}`);
      const placeKeys = place.calls[0].input.sources.map((s) => s.key);
      assert.ok(placeKeys.includes('place:1'), `应带合格地点：${JSON.stringify(placeKeys)}`);
      assert.ok(!placeKeys.includes('place:2'), '未发布地点（id=2）不该进模型输入');
      assert.ok(!placeKeys.includes('place:3'), '非主世界维度的地点（id=3）不该进模型输入');
      // 3 条都过得了 0.1 门槛且没到 5 的上限，所以这里数的是「全都该在」
      const placeCount = placeKeys.filter((k) => k.startsWith('place:')).length;
      assert.equal(placeCount, 3, `合格地点应当 3 条全在，实际 ${placeCount}：${JSON.stringify(placeKeys)}`);

      // 知识库 limit=4：1/5/6/7 四条都能检索到，第 8 条是过期来源必须被剔掉
      const know = await run('东门施工什么时候恢复');
      const knowKeys = know.calls[0].input.sources.map((s) => s.key);
      const knowCount = knowKeys.filter((k) => k.startsWith('knowledge:')).length;
      assert.equal(knowCount, 4, `知识库来源应当被 limit 截到 4 条，实际 ${knowCount}：${JSON.stringify(knowKeys)}`);
      assert.ok(!knowKeys.includes('knowledge:8'), 'source_hash 对不上的过期来源不该进模型输入');
      assert.ok(!knowKeys.includes('knowledge:3'), 'audience=exam 的资料不该被 public 检索命中');
      assert.ok(!knowKeys.includes('knowledge:4'), 'draft 状态的资料不该被检索命中');

      const noPlace = await run('树上酒店房型预订');
      assert.equal(noPlace.sql.filter((s) => s.sql.includes('FROM city_places')).length, 0, '不涉及地点时不该查 city_places');
    } finally {
      f.close();
    }
  } finally {
    cleanup();
  }
});

test('customer-answer：grounded 的每一道闸都会让答复退回兜底', async () => {
  const { newM, cleanup } = await loadBoth();
  try {
    const f = await seeded();
    try {
      const run = async (sc, question = '东门施工什么时候恢复', player = null) => {
        const prev = globalThis.fetch;
        const { impl, calls } = stubFetch({ model: sc.model || 'ok', ...sc, question, answer: sc.answer });
        globalThis.fetch = impl;
        try {
          const result = await newM.smartCustomerReply(f.env, question, sc.context ?? [], player);
          return { result, calls };
        } finally {
          globalThis.fetch = prev;
        }
      };

      const ok = await run({ answer: '恢复时间请以最新公告为准。' });
      assert.equal(ok.result.source, 'grounded_ai', '合法答复应走 grounded_ai');

      // 每道闸各来一次，都必须退回 personal 兜底。
      // 问题用 SELF_Q：只有它命中 personal-assistant 的 selfScope 口径，
      // 才会同时喂进去一条 personal 来源（answers 里有内容可照抄）+ 有兜底文本可退。
      for (const [label, sc] of [
        ['needs_human', { answer: '需要人工核实。', needsHuman: true }],
        ['照抄来源', { model: 'verbatim' }],
        ['编造数字', { answer: '当前价格为 9999 绿宝石。' }],
        ['答案超长', { answer: '答'.repeat(1600) }],
        ['答案全空白', { answer: '   ' }],
        ['source_keys 为空', { answer: '已核对。', keys: [] }],
        ['引用不存在的 key', { answer: '已核对。', keys: ['knowledge:9999'] }],
      ]) {
        const r = await run(sc, SELF_Q, PLAYER);
        assert.equal(r.result?.source, 'personal_records', `${label} 这道闸没拦住，答复被放行了`);
        assert.ok(r.result.answer.includes('以下是你当前账号的近期信息'), `${label} 应退回 personal 兜底文本`);
      }

      // VERBATIM_SOURCE_CHARS=80 的另一侧：短来源整段照抄必须放行
      const short = await run({ answer: SHORT_SOURCE, keys: ['knowledge:1'] });
      assert.equal(short.result.source, 'grounded_ai', '44 字的来源整段照抄不该被判成复读');
      // MAX_ANSWER_CHARS=1500 的边界：1499 / 1500 放行，1501 退回。
      // 用不带 player 的问题，被拦住时兜底是 null —— 这样才说明是被长度这道闸拦的，
      // 而不是「压根没检索到 knowledge:1 所以 key 校验失败」。
      for (const [n, expect] of [[1499, 'grounded_ai'], [1500, 'grounded_ai'], [1501, null]]) {
        const r = await run({ answer: '答'.repeat(n), keys: ['knowledge:1'] });
        assert.equal(r.result?.source ?? null, expect, `${n} 字的答案判定不对 —— MAX_ANSWER_CHARS 的边界变了`);
      }
    } finally {
      f.close();
    }
  } finally {
    cleanup();
  }
});
