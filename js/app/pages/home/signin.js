/**
 * Home daily check-in dialog.
 *
 * v79 拆分自原 home.js 的 signin() 函数。
 */

import { api, post, modal, requirePlayer, session, renderAccount, toast, tr } from '../../core.js';

export async function signin() {
  await requirePlayer();
  const d = await api('/api/init?action=signin-status');
  modal(
    tr('每日签到', 'Daily check-in'),
    `<div class="wide"><p>${tr('连续签到', 'Streak')} <b>${d.current_streak}</b> ${tr('天', 'days')} · 💎 ${d.emeralds}</p><p>${tr(
      '每周签到奖励从 1 到 7 绿宝石递增。',
      'Earn 1 to 7 emeralds per day in a weekly cycle.'
    )}</p>${
      d.signed_today
        ? `<p class="notice">${tr('今天已经签到，明天再来', 'Already checked in today')}</p>`
        : ''
    }</div>`,
    {
      label: tr('签到', 'Check in'),
      submit: d.signed_today
        ? null
        : async () => {
            const r = await post('/api/init?action=signin');
            toast(r.message);
            await session();
            renderAccount();
          },
    }
  );
}