// v50: 从 D1 导出 admin reply 数据, 格式化为 OpenAI fine-tune JSONL
//
// 用法:
//   1. 登录 admin 拿 session (浏览器开发者工具 → Application → Cookies → lc_session)
//   2. LC_SESSION=xxx node scripts/export-finetune-data.mjs > training.jsonl
//
// 输出: 每行一个 JSON object
//   {"messages": [
//     {"role":"system","content":"你是灯光市 AI 客服灯灯..."},
//     {"role":"user","content":"<玩家留言>"},
//     {"role":"assistant","content":"<admin 回复>"}
//   ]}
//
// 然后 OpenAI fine-tune:
//   1. openai files create -p fine-tune -f training.jsonl
//   2. openai fine_tuning.jobs create -m gpt-3.5-turbo -t file-xxx
//   3. 等完成, 拿到 ft:gpt-3.5-turbo:org::model-id
//   4. 更新 OPENAI_MODEL=ft:..., push 即可

const LC_SESSION = process.env.LC_SESSION;
const SITE = process.env.SITE || 'https://dengguang-city.pages.dev';
if (!LC_SESSION) {
  console.error('请先设 LC_SESSION=<admin session token>');
  console.error('怎么拿: 登录 admin 后, 浏览器 DevTools → Application → Cookies → lc_session');
  process.exit(1);
}

// 拉全量 messages (有 admin_reply 的)
const PAGE_SIZE = 100;
const all = [];
let offset = 0;
while (true) {
  const url = `${SITE}/api/admin/messages?status=&limit=${PAGE_SIZE}&offset=${offset}`;
  const r = await fetch(url, { headers: { Cookie: `lc_session=${LC_SESSION}` } });
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  const d = await r.json();
  if (!d.ok) { console.error('API err:', d.error); process.exit(1); }
  const page = d.messages || [];
  all.push(...page);
  if (page.length < PAGE_SIZE) break;
  offset += PAGE_SIZE;
}

// 过滤: 只保留有 admin_reply 的 (≥ 10 字, 排除太短或 fallback)
const SYSTEM = `你是「灯光市 AI 客服」灯灯。灯光市是一座 Minecraft 服务器上的像素城市。

服务市民，解答问题、指引流程、收建议。
要求：
1. 亲切、简洁、像邻家小助手
2. **总字数必须控制在 100 字以内**（含标点）
3. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
4. 如不知道, 直接说"请去联系我们页提交详情, 市政厅会人工回复"`;

let kept = 0, skipped = 0;
for (const m of all) {
  const userMsg = (m.content || '').trim();
  const reply = (m.admin_reply || '').trim();
  if (!userMsg || !reply) { skipped++; continue; }
  if (reply.length < 10) { skipped++; continue; }  // 太短的可能是 fallback
  if (reply.startsWith('🤖')) { skipped++; continue; }  // 跳过 AI 自己生成的 (避免训自己)
  const sample = {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
      { role: 'assistant', content: reply }
    ]
  };
  process.stdout.write(JSON.stringify(sample, null, 0) + '\n');
  kept++;
}

// 统计输出到 stderr (不影响 JSONL)
console.error(`\n=== 导出完成 ===`);
console.error(`原始 messages: ${all.length}`);
console.error(`用作训练样本: ${kept}`);
console.error(`跳过 (无回复/太短/AI 自我回复): ${skipped}`);
console.error(`\n下一步:`);
console.error(`  openai files create -p fine-tune -f <(cat) > file_id.txt`);
console.error(`  openai fine_tuning.jobs create -m gpt-3.5-turbo -t <FILE_ID> > job.json`);
console.error(`  openai fine_tuning.jobs list  (看 status)`);
console.error(`完成后: 拿到 ft:gpt-3.5-turbo:org::xxx, 跟我说`);
