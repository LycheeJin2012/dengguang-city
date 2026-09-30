import { endpoint, identity, reply, fail } from '../../_core/request.js';

/**
 * 今天（上海时区）的日期，形如 2026-01-31。
 *
 * 用 sv-SE 而不是手写格式串：它天然输出 YYYY-MM-DD，
 * 不用再处理时区偏移，也不用把 Date 转成 UTC 字符串。
 */
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());

/** 相对今天往前推 n 天，同样走上海时区的日历天 */
const dayOffset = (day, n) => new Date(+new Date(day) - n * 86400000).toISOString().slice(0, 10);

/**
 * 签到状态。GET 和 POST 都要用，所以单独抽出来。
 *
 * current_streak 的口径：最近一次签到是今天或昨天才延续，否则已经断了归 0。
 * reward 单独用 today_streak / today_emeralds 表达，
 * 这样前端在「今天还没签」时不会把昨天的奖励当成今天的显示。
 */
async function status(context, player) {
  const day = today();
  const rows = await context.env.DB
    .prepare(
      'SELECT signin_date,streak,emeralds_earned FROM daily_signin WHERE player_id=? ORDER BY signin_date DESC LIMIT 7'
    )
    .bind(player.id)
    .all();

  const found = rows.results.find((r) => r.signin_date === day);
  const yesterday = dayOffset(day, 1);
  const latest = rows.results[0];
  const streakContinues = latest && [day, yesterday].includes(latest.signin_date);

  return {
    logged_in: true,
    today: day,
    signed_today: !!found,
    current_streak: streakContinues ? latest.streak : 0,
    today_streak: found?.streak || 0,
    today_emeralds: found?.emeralds_earned || 0,
    emeralds: player.emeralds,
    recent: rows.results,
  };
}

export const onRequestGet = (context) =>
  endpoint(async () => {
    let player;
    try {
      player = await identity(context);
    } catch (e) {
      // 401（没登录 / 账号停用）不是错误：未登录时也要把页面渲染出来
      if (e.status === 401) {
        return reply({ logged_in: false, signed_today: false, current_streak: 0, recent: [] });
      }
      throw e;
    }
    return reply(await status(context, player));
  });

export const onRequestPost = (context) =>
  endpoint(async () => {
    const url = new URL(context.request.url);
    // 只查状态不该走 POST：老前端用 POST + ?action=signin-status 轮询
    if (url.searchParams.get('action') === 'signin-status') return onRequestGet(context);

    const player = await identity(context);
    const day = today();
    const before = await status(context, player);
    if (before.signed_today) fail(409, '今天已经签到');

    const streak = before.current_streak + 1;
    // 每 7 天一轮，第 8 天回到 1，避免奖励无限增长
    const reward = ((streak - 1) % 7) + 1;

    // D1 batch is atomic. A duplicate day rolls back the balance increment as well.
    await context.env.DB.batch([
      context.env.DB
        .prepare('INSERT INTO daily_signin(player_id,signin_date,streak,emeralds_earned,reward) VALUES(?,?,?,?,?)')
        .bind(player.id, day, streak, reward, reward),
      context.env.DB.prepare('UPDATE players SET emeralds=emeralds+? WHERE id=?').bind(reward, player.id),
    ]);

    return reply({
      signed_today: true,
      today_streak: streak,
      today_emeralds: reward,
      current_streak: streak,
      emeralds: player.emeralds + reward,
      message: `签到成功！+${reward} 💎`,
    });
  });
