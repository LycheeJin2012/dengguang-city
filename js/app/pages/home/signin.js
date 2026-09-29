/**
 * Home daily check-in dialog.
 *
 * v79 拆分自原 home.js 的 signin() 函数。
 */

import {api,post,modal,requirePlayer,session,renderAccount,toast} from '../../core.js'

export async function signin() {
  await requirePlayer();
  const d = await api('/api/init?action=signin-status');
  modal(
    '每日签到',
    `<div class="wide"><p>${'连着签到'} <b>${d.current_streak}</b> ${'天'} · 💎 ${d.emeralds}</p><p>${'一周七天，绿宝石一天比一天多。'}</p>${
      d.signed_today
        ? `<p class="notice">${'今天已经签过，明天再来'}</p>`
        : ''
    }</div>`,
    {
      label: '签到',
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