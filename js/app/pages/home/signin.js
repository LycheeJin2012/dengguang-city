/**
 * 首页每日签到弹窗。
 *
 * v79 从原 home.js 拆出来的 signin()。
 *
 * 一天只能签一次，所以「今天已签」和「还没签」是两种界面：
 * 已签时只展示连续天数，不给提交按钮 —— 让接口自己去挡一次没必要的请求。
 */

import { api, post, modal, requirePlayer, session, renderAccount, toast } from '../../core.js';

export async function signin() {
  await requirePlayer();

  const status = await api('/api/init?action=signin-status');
  const signedToday = status.signed_today;

  const summary =
    `<p>连着签到 <b>${status.current_streak}</b> 天 · 💎 ${status.emeralds}</p>` +
    '<p>一周七天，绿宝石一天比一天多。</p>';

  modal('每日签到', `<div class="wide">${summary}${signedToday ? '<p class="notice">今天已经签过，明天再来</p>' : ''}</div>`, {
    label: '签到',
    // 已签过：label 保留（弹窗需要它），但不给 submit，点击就只是关掉
    submit: signedToday
      ? null
      : async () => {
          const result = await post('/api/init?action=signin');
          toast(result.message);
          // 签到会改绿宝石余额，所以账户区和会话都要重新拉一遍
          await session();
          renderAccount();
        },
  });
}
