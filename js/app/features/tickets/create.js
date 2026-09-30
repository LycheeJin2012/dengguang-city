/**
 * 递交工单（市民侧）+ 管理员编号名录。
 *
 * 原来 createTicket 是 js/app/ticket-form.js 里最长的那个函数：一行 2200 字符，
 * 里面同时有五种工单类型的选择、按类型显隐的联动、举报玩家的联想搜索、
 * 附件选择器的挂载和提交。这里按「表单长什么样 → 提交时做什么 →
 * 字段之间怎么联动」三段分开写。
 *
 * 五个不能改的行为：
 *   1. **字段显隐由 kind 决定，但两个字段都是「隐藏 + disabled + required」三件套**。
 *      只藏不 disable 的话，隐藏的举报人/管理员字段仍会被 FormData 收进去，
 *      递上去的单会带着一个空的 target_player_id / target_admin_id。
 *   2. **举报玩家是 datalist 联想，不是下拉**：玩家可以自填没被搜到的人名。
 *      hidden 的 target_player_id 只在「正好搜到同名玩家」时才填，用来让后端
 *      走回避规则；没搜到就留空，按自填名字处理。
 *   3. **联想搜索的 200ms 防抖 + 竞态防护**。响应回来时必须重新核对
 *      「弹窗还在不在」和「输入框里的字是不是还是我搜的那几个字」，
 *      否则慢的那次响应会覆盖用户新敲的内容，datalist 会跟输入框对不上。
 *   4. **picker 在 modal() 之后才赋值**，但 submit 回调里要用它。因为回调
 *      一定发生在函数返回之后（用户点提交），所以闭包读到的一定是赋值后的值。
 *      不要因为「picker 可能 undefined」就把它提到 modal 之前。
 *   5. **onCreated 抛错只弹提示，不影响递交结果**。工单已经建好了，
 *      只是后续跳转（比如切到「我的工单」页签）失败，不能把错误当成递交失败。
 */

import { $, api, post, field, modal, requirePlayer, toast, esc } from '../../core.js';
import { attachmentPicker } from '../../attachments.js';

/** 五种工单类型。下拉里的顺序和文案是锁定的。 */
const KIND_OPTIONS = [
  ['message', '留言'],
  ['service', '市政服务'],
  ['bug', '坏了/出故障'],
  ['report', '举报玩家'],
  ['admin_complaint', '投诉管理员'],
];

/** 管理员编号名录：同名同姓的按编号认人，投诉前先对一遍。 */
export async function showAdminDirectory() {
  await requirePlayer();
  const d = await api('/api/directory?kind=admins');
  modal(
    '管理员编号名录',
    `<div class="wide"><p>市政厅里有几个同名同姓的，投诉前先按编号认准人。</p>${d.admins
      .map((a) => `<div class="row"><b>#${a.id}</b> · ${esc(a.username)}</div>`)
      .join('')}</div>`
  );
}

/**
 * 打开「给市政厅捎句话」弹窗。
 * @param {object} opts
 * @param {string} [opts.kind]     预选的类型
 * @param {object} [opts.initial]  预填 {title, body}（客服建议工单会用）
 * @param {(result:object)=>Promise<void>} [opts.onCreated] 递交成功后的收尾
 * @returns {Promise<Element>} 弹窗元素
 */
export async function createTicket({ kind = 'message', onCreated = () => {}, initial = {} } = {}) {
  const player = await requirePlayer();
  const directory = await api('/api/directory?kind=admins');
  let picker;
  let players = [];

  // 表单主体。字段顺序就是页面上的从上到下顺序，别调。
  const content =
    field('kind', '这是什么事', 'select', kind, { options: KIND_OPTIONS }) +
    field('target_player_name', '被举报玩家（可自填）', 'text', '', { required: false, maxlength: 64 }) +
    // datalist 装联想结果，hidden 的 id 装「正好搜到的那个人」
    '<datalist id="report-player-options"></datalist><input type="hidden" name="target_player_id">' +
    field('target_admin_id', '要投诉的管理员', 'select', '', {
      required: false,
      // 开头那个空串是「不投诉任何人」的选项
      options: ['', ...directory.admins.map((a) => [a.id, `#${a.id} · ${a.username}`])],
    }) +
    field('title', '一句话标题', 'text', initial.title || '', { maxlength: 90 }) +
    field('body', '把事说清楚', 'textarea', initial.body || '', { maxlength: 2000 }) +
    field('contact', '联系方式（只有承办人看得到）', 'text', player.email || '', { required: false }) +
    field(
      'public_consent',
      '同意公开（文字和答复先经人过一遍再挂到公开页，附件永远不公开）',
      'checkbox',
      false
    ) +
    `<p class="muted wide">时间、地点、账号、怎么复现，都写上，我们少跑一趟。<br>没勾公开的工单，只有你和承办人看得到。</p>`;

  const dialog = modal('给市政厅捎句话', content, {
    wide: true,
    label: '递上去',
    submit: async (values) => {
      // ids() 会在「有文件没传完」时抛错 → 弹窗统一显示在 .form-error 上
      const result = await post('/api/tickets', { ...values, attachment_ids: picker.ids() });
      // 提交成功后才 commit：这些上传已经归这单了，关闭弹窗时不能再删
      picker.commit();
      toast('递上去了，去“我的工单”看它走到哪一步');
      // 收尾失败（比如切页签失败）不影响工单本身已经建好这件事
      try {
        await onCreated(result);
      } catch (e) {
        toast(e.message, true);
      }
    },
  });

  const kindInput = $('[name=kind]', dialog);
  const nameInput = $('[name=target_player_name]', dialog);
  const adminInput = $('[name=target_admin_id]', dialog);
  const idInput = $('[name=target_player_id]', dialog);
  nameInput.setAttribute('list', 'report-player-options');

  let timer;

  /** 按当前类型决定「举报玩家」和「投诉管理员」两组字段的显隐 */
  const setTargets = () => {
    const reporting = kindInput.value === 'report';
    const complaint = kindInput.value === 'admin_complaint';

    nameInput.closest('label').hidden = !reporting;
    nameInput.disabled = !reporting;
    nameInput.required = reporting;
    idInput.disabled = !reporting;

    adminInput.closest('label').hidden = !complaint;
    adminInput.disabled = !complaint;
    adminInput.required = complaint;
  };
  kindInput.onchange = setTargets;
  setTargets();

  nameInput.addEventListener('input', () => {
    // 先用已缓存的 players 同步一次 hidden id：完全匹配上名字才填，
    // 填不上就清空 —— 留着上一个玩家的 id 比留空更糟。
    idInput.value = players.find((p) => p.username === nameInput.value.trim())?.id || '';

    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const q = nameInput.value.trim();
        const d = await api('/api/directory?kind=players&q=' + encodeURIComponent(q));
        // 竞态防护：弹窗可能已经关了，或者用户在这 200ms 里又改了字。
        // 两种情况都直接丢弃这次响应，否则 datalist 会跟输入框对不上。
        if (!dialog.isConnected || nameInput.value.trim() !== q) return;
        players = d.players;
        $('#report-player-options', dialog).innerHTML = players
          .map((p) => `<option value="${esc(p.username)}">#${p.id}</option>`)
          .join('');
        idInput.value = players.find((p) => p.username === q)?.id || '';
      } catch {
        // 联想失败不打扰用户：还能自填名字，照样能递
      }
    }, 200);
  });

  // 关弹窗时把没回来的防抖定时器掐掉，免得它在关掉之后还在改 DOM
  dialog.addEventListener('close', () => clearTimeout(timer));

  picker = attachmentPicker(dialog);
  return dialog;
}
