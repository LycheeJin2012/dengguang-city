// v50: AI 自动回复 (简化版, 关键词匹配 + 模板回复)
// 真实 LLM 接入: 把 AI_REPLY_API_KEY 环境变量设上后, 自动走远端 API
// 未设: 用本地关键词匹配 (无外部依赖, 离线可用)

const REPLY_TEMPLATES = [
  {
    keywords: ['酒店', '预订', '房间', '订房', '树上'],
    reply: '🏨 树上酒店正在筹建中, 房型与定价由合作社定稿后正式上线。\n您可以先到主页 [树上酒店] 区块看草案, 开业后会发公告通知。',
  },
  {
    keywords: ['赛车', '赛道', '试车', '试跑', '驾照', '开车'],
    reply: '🏎️ 国际赛车场 (拟建) 与驾照考试 (B/A/S 三级) 都在筹备中。\n请关注主页 [国际赛车场] 和 [驾照考试] 区块, 上线后会发公告 + 站内通知。',
  },
  {
    keywords: ['注册', '登录', '账号', '密码', '忘记'],
    reply: '👤 注册: 主页右上角 [登录] → [注册新号] (2-20 字符 + 邮箱)。\n忘记密码: 登录页点 [忘记密码] 走邮件重置。\n推荐: 注册通行密钥 (Touch ID/Face ID), 抗钓鱼, 无需记密码。',
  },
  {
    keywords: ['公告', '新闻', '更新', '市政', '政府'],
    reply: '📜 所有正式公告会发在主页 [市政公告] 区块 + 站内通知订阅。\n勾选 [通知订阅] 后, 新公告会推送给你。',
  },
  {
    keywords: ['玩家', '市民', '注册市民', '加入'],
    reply: '👋 欢迎加入灯光市! 注册流程: 主页右上 [登录] → [注册新号]。\n注册后你就是正式市民, 可以留言、订酒店、报名赛车。',
  },
  {
    keywords: ['bug', '问题', '错误', '建议', '反馈', '投诉'],
    reply: '🐛 感谢反馈! 您可以: \n1) 在本页追加描述\n2) 到主页 [📬 联系我们] 提交工单\n3) 加入 [💬 私信] 联系灯灯 (AI 客服)\n市政厅会尽快回复。',
  },
  {
    keywords: ['你好', '您好', 'hi', 'hello', '在吗', '在么'],
    reply: '👋 你好! 我是灯灯, 灯光市 AI 客服。\n可以问我关于: 酒店预订 / 赛车场 / 驾照考试 / 注册流程 / 公告订阅。\n紧急问题请用 [📬 联系我们] 提交工单, 管理员会看到。',
  },
];

const FALLBACK_REPLY = '🤖 灯灯收到您的留言了! 但我没看懂具体问题。\n建议: \n1) 描述更具体 (例如 "怎么预订酒店" / "怎么报名赛车")\n2) 到 [📬 联系我们] 提交工单, 管理员会人工回复\n3) 等我接入更聪明的 AI 模型, 敬请期待 ✨';

// 远端 LLM 接入 (有 API key 时)
async function remoteAIReply({ name, content, apiKey, apiUrl }) {
  try {
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是灯光市 AI 客服 "灯灯"。回答简短 (50 字内), 友好, 用 emoji。不要编造不存在的信息。' },
          { role: 'user', content: `${name}: ${content}` },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.warn('[ai] remote LLM failed:', e?.message || e);
    return null;
  }
}

// 本地关键词匹配
function localAIReply(content) {
  for (const t of REPLY_TEMPLATES) {
    if (t.keywords.some(k => content.includes(k))) return t.reply;
  }
  return FALLBACK_REPLY;
}

/**
 * AI 自动回复
 * @param {object} opts - { name, content }
 * @param {object} env - Cloudflare env (可选, 读 AI_REPLY_API_KEY)
 * @returns {Promise<string|null>}
 */
export async function aiAutoReply(opts, env) {
  const { name = '市民', content = '' } = opts || {};
  if (!content || content.length < 2) return null;
  // 优先远端 LLM
  if (env?.AI_REPLY_API_KEY && env?.AI_REPLY_API_URL) {
    const r = await remoteAIReply({ name, content, apiKey: env.AI_REPLY_API_KEY, apiUrl: env.AI_REPLY_API_URL });
    if (r) return r;
  }
  return localAIReply(content);
}

// 拿 / 创建 AI bot player (DM 列表里灯灯 bot)
// v50: 简化, 不强制创建, 由调用方决定
export async function getOrCreateAiBot(env) {
  if (!env?.DB) return null;
  const exist = await env.DB.prepare('SELECT id, username, avatar_emoji FROM players WHERE username = ?').bind('灯灯').first();
  if (exist) return exist;
  // 不强制创建, 返回 null 让调用方处理
  return null;
}
