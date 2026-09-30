/**
 * 管理员侧的「抄近路」面板：同类工单历史 + 已审核过的知识答案。
 *
 * 原来整个文件是一行，里面塞着 details 面板的创建、首次展开的懒加载，
 * 以及一段三层嵌套的 innerHTML 模板。现在只做两件事分开写：
 * 建面板（懒加载壳）+ 画内容（模板）。
 *
 * 三个不能改的行为：
 *   1. **懒加载**：`panel.ontoggle` 里 `loaded` 门闩保证只请求一次。
 *      展开→收起→再展开时不会重新打 /api/admin/ticket-insights。
 *      这里不能改用 region() 自带的重试，那会在每次展开时重复请求。
 *   2. **权限在服务端**：接口是 /api/admin/ticket-insights，投诉单和玩家单会
 *      返回 403。前端不做任何过滤，失败由 region() 统一显示错误 —— 前端加判断
 *      只会让界面和后端的权限模型对不上。
 *   3. **两段空态文案**：「没翻到你有权看的相似工单」和「没找到能直接引用的知识」
 *      是锁定文案，且含义不同（没权限 ≠ 库里没有），不要合并。
 */

import { $, api, region, esc, text, status } from './core.js';

/** 三块内容：口径说明 / 相似工单 / 可引用的知识 */
function insightsMarkup(d) {
  const similar =
    d.similar
      .map(
        (t) =>
          `<div class="row"><b>#${t.id} ${esc(t.title)}</b> ${status(t.status)}<p>${text(t.excerpt)}</p></div>`
      )
      .join('') || '<p>没翻到你有权看的相似工单。</p>';

  const knowledge =
    d.knowledge
      .map(
        (k) =>
          `<div class="notice"><b>知识 #${k.id} ${esc(k.title)} · v${k.revision}</b><p>${text(k.answer)}</p></div>`
      )
      .join('') || '<p>没找到能直接引用的知识，这单得自己核。</p>';

  return (
    `<p class="muted">${esc(d.note)}</p>` +
    `<h3>像这一单的历史</h3>${similar}` +
    `<h3>已审核过的答案</h3>${knowledge}`
  );
}

/**
 * 在工单弹窗的 .form-grid 末尾挂上「抄近路」折叠面板。
 * @param {Element} dialog 管理员的工单处理弹窗
 * @param {string|number} id 当前工单 id
 */
export function attachTicketInsights(dialog, id) {
  const panel = document.createElement('details');
  panel.className = 'wide';
  panel.innerHTML = '<summary>抄近路：以前怎么处理的</summary><div data-insights></div>';
  $('.form-grid', dialog).append(panel);

  let loaded = false;

  panel.ontoggle = () => {
    // 只在「展开」时加载；收起不做事，否则每次收起都会白打一次接口
    if (!panel.open || loaded) return;
    // 门闩在发请求**之前**就落下：连点展开时第二次 toggle 直接被挡掉
    loaded = true;

    region(
      $('[data-insights]', panel),
      () => api('/api/admin/ticket-insights?id=' + encodeURIComponent(id)),
      (d, box) => {
        box.innerHTML = insightsMarkup(d);
      }
    );
  };
}
