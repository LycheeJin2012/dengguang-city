/**
 * 派单规矩面板（「派单」tab 顶部那块）。
 *
 * 展示自动派单的当前配置，并让超管改它。改完直接重画本面板
 * （renderDispatchPolicy(el)）—— 不走整页 loadActive，因为这块不在
 * #records 里，整页重载会把它连同工单列表一起刷掉。
 *
 * 面板是只读的，除了超管能点开「调分工」。「调分工」里的下拉选项
 * 是打开时一次性抓的 admins 列表 —— 面板不轮询，所以中途新增的管理员
 * 要重新进来才看得到，这是有意的：避免管理员在填一半时选项列表突然变了。
 */

import { $, api, patch, esc, modal, field, action, toast, state } from './core.js';

// 锁定的中文文案。提出具名常量只是为了让下面的模板串短一点 ——
// 文字本身逐字未改（COPY_LOCK.json 管的就是这些）。
const WHY = '近 180 天同类事项，看谁亲自办结得多、平均多久、重开过几次、现在手上忙不忙。样本少于 3 个就不猜专长。每次派单重算一次，不改模型和权限。';
const NO_EXPERIENCE = '历史还不够，先按分工和谁手头松来派。';

export async function renderDispatchPolicy(el) {
  const data = await api('/api/admin/dispatch-settings');
  const { config, preferred } = data;

  /** 管理员显示名。没定下人就直说，别留空白让人以为出错了。 */
  const name = (a) => (a ? `#${a.id} · ${a.username}` : '没定下人，请超管点名');

  el.innerHTML =
    `<div class="panel">` +
    `<div class="row-head">` +
    `<h3>${'自动派单'} · ${config.enabled ? '开着' : '先歇着'}</h3>` +
    // 调分工只有超管能点；普通管理员看到的是同样的信息但没有按钮
    (state.session?.user?.role === 'super'
      ? `<button id="dispatch-config">${'调分工'}</button>`
      : '') +
    `</div>` +
    `<p>${'急事先给'}: <b>${esc(name(preferred.urgent))}</b> · ${'绕事先给'}: <b>${esc(name(preferred.complex))}</b></p>` +
    `<p class="muted">${'新工单一到就自己找人；又急又绕时先顾急的。你手动改过的人，它不会再盖掉。'}</p>` +
    `<p>${'每人手上最多'}: ${config.max_active} · ${
      data.ai_configured ? '有 AI 分类和历史经验帮忙' : '没配 AI：按分工和历史记录自己派'
    }</p>` +
    `<details>` +
    `<summary>${'凭什么这么派'}</summary>` +
    `<p>${WHY}</p>` +
    (data.experience.length
      ? `<ul>${data.experience
          .map(
            (e) =>
              `<li>#${e.admin_id} · ${'办结'} ${e.completed} · ${'平均小时'} ${Number(
                e.average_hours || 0
              ).toFixed(1)} · ${'重开过'} ${e.reopened}</li>`
          )
          .join('')}</ul>`
      : `<p>${NO_EXPERIENCE}</p>`) +
    `</details>` +
    `</div>`;

  // 没有超管身份时这个按钮根本不存在，?. 直接跳过
  $('#dispatch-config', el)?.addEventListener('click', (e) =>
    action(e.currentTarget, async () => {
      // 第一项是空值：允许把「急事先给」清空，改回按名字自动认人
      const options = [
        ['', '按名字自动认人'],
        ...data.admins.map((a) => [
          a.id,
          `#${a.id} · ${a.username}${a.player_username ? ' / ' + a.player_username : ''}`,
        ]),
      ];
      modal(
        '自动派单',
        field('enabled', '新工单自动派单', 'checkbox', config.enabled) +
          field('urgent_admin_id', '急事先给（wzc）', 'select', config.urgent_admin_id || '', {
            required: false,
            options,
          }) +
          field('complex_admin_id', '绕事先给（漫画家）', 'select', config.complex_admin_id || '', {
            required: false,
            options,
          }) +
          field('max_active', '每人最多在办', 'number', config.max_active, { min: 1, max: 100 }),
        {
          submit: async (values) => {
            await patch('/api/admin/dispatch-settings', values);
            toast('派单规矩改好了');
            await renderDispatchPolicy(el);
          },
        }
      );
    })
  );
}
