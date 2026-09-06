// v50: 用 CF D1 HTTP API 直接拉数据, 不需要 admin session
//
// 用法:
//   1. 拿 CF API Token (需要 D1:Read 权限):
//      https://dash.cloudflare.com → My Profile → API Tokens → Create Token
//      → 模板 'Cloudflare D1: Read' (只要 read 权限, 别给 write)
//   2. 拿 Account ID:
//      CF Dashboard → Workers & Pages → dengguang-city → 右栏 Account ID
//   3. 跑:
//      CF_API_TOKEN=xxx CF_ACCOUNT_ID=yyy node scripts/export-finetune-d1.mjs > training.jsonl
//
// 优点: 不需要 admin 登录, 不需要 lc_session cookie, 跑得快
// 缺点: 拿不到 admin 上下文 (admin_reply 仍能拿, 因为是同一张 messages 表)

const TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DB_ID = '8014f3c2-e578-4e7d-8c54-c37c3b28f401';
if (!TOKEN || !ACCOUNT_ID) {
  console.error('请先设:');
  console.error('  CF_API_TOKEN=<Cloudflare API Token, 模板 D1:Read>');
  console.error('  CF_ACCOUNT_ID=<dengguang-city 项目右侧的 Account ID>');
  process.exit(1);
}

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;

async function query(sql, params = []) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  const d = await r.json();
  if (!d.success) { console.error('API err:', d); process.exit(1); }
  return d.result?.[0]?.results || [];
}

// 1) 看下 messages 表有多少行
const count = await query('SELECT COUNT(*) AS n FROM messages WHERE admin_reply IS NOT NULL AND admin_reply != ""');
console.error(`D1 里有 admin_reply 的留言: ${count[0].n}`);

// 2) 拉全部有 admin_reply 的留言
const rows = await query(`
  SELECT id, name, content, admin_reply, created_at
  FROM messages
  WHERE admin_reply IS NOT NULL
    AND admin_reply != ""
    AND admin_reply NOT LIKE '🤖%'   -- 跳过 AI 自己生成的 (避免训自己)
    AND LENGTH(TRIM(admin_reply)) >= 10
  ORDER BY created_at ASC
`);
console.error(`过滤后训练样本: ${rows.length}`);

// 3) 格式化为 OpenAI fine-tune JSONL
const SYSTEM = `你是「灯光市 AI 客服」灯灯。灯光市是一座 Minecraft 服务器上的像素城市。

服务市民，解答问题、指引流程、收建议。
要求：
1. 亲切、简洁、像邻家小助手
2. **总字数必须控制在 100 字以内**（含标点）
3. 严禁编造任何具体信息：数字、电话、邮箱、人名、活动名、日期等
4. 如不知道, 直接说"请去联系我们页提交详情, 市政厅会人工回复"`;

let kept = 0;
for (const r of rows) {
  const sample = {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: (r.content || '').trim() },
      { role: 'assistant', content: (r.admin_reply || '').trim() }
    ]
  };
  process.stdout.write(JSON.stringify(sample) + '\n');
  kept++;
}
console.error(`\n=== 导出 ${kept} 条 → training.jsonl ===`);
console.error(`\n下一步: 把 training.jsonl 发我看, 我用你的 OpenAI key 启 fine-tune job`);
console.error(`或者: 你本地 curl 直接 upload 也行 (看 README)`);
