// v45 重写 (v45 fix): signin 相关 actions
// 路由: GET /api/init?action=signin-status (前端用 GET 拿签到状态)
//      POST /api/init?action=signin | signin-status (POST 签到, GET 查状态)
import { ok, err, readToken, getSession } from '../../_shared.js';

// 通用: 解析 cookie 取 player session
async function getPlayerSession(env, request) {
  const token = readToken(request);
  if (!token) return { ok: false, reason: '未登录' };
  const sess = await getSession(env, token);
  if (!sess || !sess.player_id) return { ok: false, reason: '需要玩家登录' };
  if (new Date(sess.expires_at) <= new Date()) return { ok: false, reason: '会话已过期' };
  return { ok: true, sess, player_id: sess.player_id };
}

// v45 修: 暴露 getPlayerSession 供 GET handler 复用 (Stage 1 漏了 GET handler,
//        前端调 GET /api/init?action=signin-status 拿到的居然是 tables 列表, 不刷新)
export { getPlayerSession };

// v45 新增: 抽 signin-status 数据查询, GET/POST 共享
async function getSigninStatusData(env, playerId) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const [p, todayRow, recent, totalRow] = await Promise.all([
    env.DB.prepare('SELECT id, username, emeralds FROM players WHERE id = ?').bind(playerId).first(),
    env.DB.prepare('SELECT id, streak, emeralds_earned FROM daily_signin WHERE player_id = ? AND signin_date = ?').bind(playerId, today).first(),
    env.DB.prepare('SELECT signin_date, streak, emeralds_earned FROM daily_signin WHERE player_id = ? ORDER BY signin_date DESC LIMIT 7').bind(playerId).all(),
    env.DB.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(streak), 0) AS max_streak FROM daily_signin WHERE player_id = ?').bind(playerId).first(),
  ]);
  if (!p) return null;
  let curStreak = 0;
  const recentList = (recent && recent.results) || [];
  if (recentList.length) {
    curStreak = recentList[0].streak;
    const yest = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
    if (recentList[0].signin_date !== today && recentList[0].signin_date !== yest) {
      curStreak = 0;
    }
  }
  return {
    signed_today: !!todayRow,
    today_streak: todayRow ? todayRow.streak : 0,
    today_emeralds: todayRow ? todayRow.emeralds_earned : 0,
    current_streak: curStreak,
    max_streak: totalRow ? totalRow.max_streak : 0,
    total_days: totalRow ? totalRow.c : 0,
    emeralds: p.emeralds || 0,
    recent: recentList,
    today,
  };
}

// v45 新增: GET handler (前端用 GET 拉签到状态, Stage 1 漏写, 默认 fallback 返 tables 列表)
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (action === 'signin-status') {
    const auth = await getPlayerSession(env, request);
    if (!auth.ok) {
      // 即使未登录也返回 ok (前端要拿 logged_in: false 渲染 UI)
      return ok({ logged_in: false, signed_today: false, today_streak: 0, today_emeralds: 0, current_streak: 0, max_streak: 0, total_days: 0, emeralds: 0, recent: [], today: '' });
    }
    const data = await getSigninStatusData(env, auth.player_id);
    if (!data) return err(404, '玩家不存在');
    return ok(data);
  }
  return err(404, '未知 signin GET action: ' + action);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (action === 'signin-status') {
    const auth = await getPlayerSession(env, request);
    if (!auth.ok) {
      // 即使未登录也返回 ok (前端要拿 logged_in: false 渲染 UI)
      return ok({ logged_in: false, signed_today: false, today_streak: 0, today_emeralds: 0, current_streak: 0, max_streak: 0, total_days: 0, emeralds: 0, recent: [], today: '' });
    }
    const pid = auth.player_id;
    // v43.3: 4 个查询 Promise.all 并发
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const [p, todayRow, recent, totalRow] = await Promise.all([
      env.DB.prepare('SELECT id, username, emeralds FROM players WHERE id = ?').bind(pid).first(),
      env.DB.prepare('SELECT id, streak, emeralds_earned FROM daily_signin WHERE player_id = ? AND signin_date = ?').bind(pid, today).first(),
      env.DB.prepare('SELECT signin_date, streak, emeralds_earned FROM daily_signin WHERE player_id = ? ORDER BY signin_date DESC LIMIT 7').bind(pid).all(),
      env.DB.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(streak), 0) AS max_streak FROM daily_signin WHERE player_id = ?').bind(pid).first(),
    ]);
    if (!p) return err(404, '玩家不存在');
    let curStreak = 0;
    const recentList = (recent && recent.results) || [];
    if (recentList.length) {
      curStreak = recentList[0].streak;
      const yest = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
      if (recentList[0].signin_date !== today && recentList[0].signin_date !== yest) {
        curStreak = 0;
      }
    }
    return ok({
      signed_today: !!todayRow,
      today_streak: todayRow ? todayRow.streak : 0,
      today_emeralds: todayRow ? todayRow.emeralds_earned : 0,
      current_streak: curStreak,
      max_streak: totalRow ? totalRow.max_streak : 0,
      total_days: totalRow ? totalRow.c : 0,
      emeralds: p.emeralds || 0,
      recent: recentList,
      today,
    });
  }

  if (action === 'signin') {
    const auth = await getPlayerSession(env, request);
    if (!auth.ok) return err(401, auth.reason);
    const pid = auth.player_id;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const [p, todayRow] = await Promise.all([
      env.DB.prepare('SELECT id, username, emeralds FROM players WHERE id = ?').bind(pid).first(),
      env.DB.prepare('SELECT id, streak, emeralds_earned FROM daily_signin WHERE player_id = ? AND signin_date = ?').bind(pid, today).first(),
    ]);
    if (!p) return err(404, '玩家不存在');
    if (todayRow) {
      return err(409, '今天已经签到过了, 明天再来', {
        signed_today: true,
        today_streak: todayRow.streak,
        today_emeralds: todayRow.emeralds_earned,
        emeralds: p.emeralds || 0,
      });
    }
    // 算本次连续天数 (看昨天是否签到)
    const yest = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
    const yestRow = await env.DB.prepare(
      'SELECT id, streak FROM daily_signin WHERE player_id = ? AND signin_date = ?'
    ).bind(pid, yest).first();
    const newStreak = yestRow ? (yestRow.streak + 1) : 1;
    // 7 天一个循环, 第 1 天 1 绿宝, 第 7 天 7 绿宝
    const dayInCycle = ((newStreak - 1) % 7) + 1;
    const reward = dayInCycle;
    try {
      await env.DB.prepare(
        'INSERT INTO daily_signin (player_id, signin_date, streak, emeralds_earned) VALUES (?, ?, ?, ?)'
      ).bind(pid, today, newStreak, reward).run();
    } catch (e) {
      return err(409, '今天已经签到过了, 明天再来');
    }
    const newEmeralds = (p.emeralds || 0) + reward;
    await env.DB.prepare('UPDATE players SET emeralds = ? WHERE id = ?').bind(newEmeralds, pid).run();
    return ok({
      signed_today: true,
      today_streak: newStreak,
      today_emeralds: reward,
      day_in_cycle: dayInCycle,
      current_streak: newStreak,
      emeralds: newEmeralds,
      message: '签到成功! +' + reward + ' 💎 (本周第 ' + dayInCycle + ' / 7 天)',
    });
  }

  return err(404, '未知 signin action: ' + action);
}
