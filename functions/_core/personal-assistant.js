import { myAffairs } from './my-affairs.js';

/** 各业务状态的中文说法。缺了就退回原始 status 字符串 */
const labels = {
  open: '待处理',
  in_progress: '进行中',
  resolved: '已办结',
  closed: '已结束',
  pending: '待审核',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  queued: '等待人工',
  active: '人工已接入',
  ended: '人工会话已结束',
  needs_review: '待复核',
  graded: '已批改',
  submitted: '已提交',
  passed: '已通过',
  failed: '未通过',
  generating: '生成中',
  grading: '批改中',
  abandoned: '已放弃',
};

/**
 * 问题看起来在问「我的事务」时才返回个人数据，否则返回 null。
 *
 * 用关键词而不是让模型自己挑 —— 这是喂给 AI 的唯一个人数据入口，
 * 判错一次就等于把一个玩家的资料递给另一个问题。
 */
const selfScope =
  /(?:我|本人).{0,15}(?:事务|近况|工单|考试|酒店|预订|驾照|复核|进度|余额|绿宝石|未读|通知|提醒|待办)|^(?:最近事务|我的近况|待办提醒|查看进度)/;

/** 问题里提到哪几类事务。没提到就全给（上面已经确认是问个人事务）。 */
function requestedKinds(question) {
  const kinds = [];
  if (/工单/.test(question)) kinds.push('ticket');
  if (/考试|成绩|复核/.test(question)) kinds.push('exam', 'appeal');
  if (/酒店|预订/.test(question)) kinds.push('booking');
  if (/驾照/.test(question)) kinds.push('license');
  return kinds;
}

/** 一条事务 → 给模型看的一行。不同 kind 补充不同的字段，其余字段一律不带 */
function toRow(r) {
  return {
    title: r.title,
    status: labels[r.status] || r.status,
    created_at: r.created_at,
    // 只有考试才有分数和待批数
    ...(r.kind === 'exam' ? { score: r.score, pending_count: r.pending_count } : {}),
    // 只有预订才有入住/退房日期
    ...(r.kind === 'booking' ? { in_date: r.in_date, out_date: r.out_date } : {}),
    attention: r.attention,
    // 最近一次回复截断到 1000 字，够模型引用，又不至于把整段原文塞进去
    ...(r.admin_reply ? { latest_reply: r.admin_reply.slice(0, 1000), replied_at: r.replied_at } : {}),
  };
}

/** 兜底文本里的单行摘要。与 toRow 同一套字段，但给人读、不给模型读 */
function summaryLine(r) {
  return (
    r.title +
    '：' +
    r.status +
    (r.score != null ? '，' + r.score + ' 分' : '') +
    (r.latest_reply ? '。最近回复：' + r.latest_reply.slice(0, 180) : '')
  );
}

/** 没有模型可用时的兜底纯文本。措辞刻意保守：不代表完整历史、不作处理结论 */
function plainSummary(data, rows, player) {
  const lines = rows.length
    ? '\n' + rows.slice(0, 5).map(summaryLine).join('\n')
    : '暂时没有查到近期事务。';

  return (
    '以下是你当前账号的近期信息：未读通知 ' +
    data.unread_count +
    ' 条。' +
    lines +
    '\n网站绿宝石余额 ' +
    player.emeralds +
    '（与游戏背包尚未同步）。\n可在“我的事务”查看详情。这里仅显示最近记录，不代表完整历史；涉及原因或未记录结果，需要工作人员核实。'
  );
}

/**
 * 玩家个人事务 → 一条 personal 来源 + 一段兜底文本。
 * 不满足个人范围时返回 null，调用方据此决定要不要带 personal 来源。
 */
export async function personalSources(db, player, question) {
  if (!player || !selfScope.test(question)) return null;

  const data = await myAffairs(db, player.id);

  const kinds = requestedKinds(question);
  const selection = kinds.length ? data.items.filter((r) => kinds.includes(r.kind)) : data.items;
  const rows = selection.slice(0, 15).map(toRow);

  // content 是喂给模型的事实。emerald_note 是硬约束：网站余额 ≠ 游戏背包
  const content = JSON.stringify({
    scope: '仅当前登录玩家的近期记录，不代表完整历史；状态是查询时快照',
    as_of: data.as_of,
    unread_notifications: data.unread_count,
    website_emeralds: player.emeralds,
    emerald_note: '网站账本余额，不是游戏背包数量，尚未同步',
    recent: rows,
  });

  // 兜底文本同样要声明边界，并复述最要紧的余额/未读数
  const fallback =
    '以下是你当前账号的近期信息：未读通知 ' +
    data.unread_count +
    ' 条。' +
    (rows.length
      ? '\n' +
        rows
          .slice(0, 5)
          .map(
            (r) =>
              r.title +
              '：' +
              r.status +
              (r.score != null ? '，' + r.score + ' 分' : '') +
              (r.latest_reply ? '。最近回复：' + r.latest_reply.slice(0, 180) : '')
          )
          .join('\n')
      : '暂时没有查到近期事务。') +
    '\n网站绿宝石余额 ' +
    player.emeralds +
    '（与游戏背包尚未同步）。\n可在“我的事务”查看详情。这里仅显示最近记录，不代表完整历史；涉及原因或未记录结果，需要工作人员核实。';

  return {
    sources: [{ key: 'personal:current', kind: 'personal', id: player.id, title: '我的事务 · 当前账号', url: '/affairs.html', content }],
    fallback,
  };
}
