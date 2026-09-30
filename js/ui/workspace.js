/**
 * 工作区骨架：页头标题、区块标题、导航条、页签。
 *
 * 这些是全站布局的积木，输出的 HTML 逐字固定，有测试直接断言
 * （页签的 id / aria-controls 关联）。
 */

import { escapeHtml as esc } from './html.js';

export function pageHeading(title, eyebrow = '') {
  return `<header class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1></div></header>`;
}

export function sectionHeading(title, eyebrow = 'LIGHT CITY') {
  return `<header class="section-head"><h2>${esc(title)}</h2><span class="eyebrow">${esc(eyebrow)}</span></header>`;
}

/**
 * 把 <main> 套进工作区容器，并在页头下方插入导航条。
 *
 * 重复调用是安全的：`.app-workspace` 已经存在就直接返回。
 * shell() 会在每个页面跑一次，但有些页面会自己再调一次。
 */
export function mountWorkspace(navigation, label) {
  const main = document.querySelector('main');
  if (document.querySelector('.app-workspace')) return;

  const frame = document.createElement('div');
  frame.className = 'app-workspace';

  const rail = document.createElement('aside');
  rail.className = 'site-rail';
  rail.innerHTML = `<nav id="navigation" aria-label="${esc(label)}">${navigation}</nav>`;

  document.querySelector('#header').append(rail);
  main.before(frame);
  frame.append(main);
}

/**
 * 页签条。只出 HTML，事件交给 bindTabs。
 *
 * panelId 和 panelPrefix 二选一：前者给全名，后者是前缀 + key 拼起来。
 * 两者都没传就不输出 aria-controls —— 无障碍关联宁可没有，
 * 也不要指向一个不存在的面板。
 */
export function tabsMarkup(items, active, { id = '', label = '', panelPrefix = '', panelId = '' } = {}) {
  const panelFor = (key) => panelId || panelPrefix + key;

  return (
    `<div class="tabs" ${id ? `id="${esc(id)}"` : ''} role="tablist" aria-label="${esc(label)}">` +
    items
      .map(
        (i) =>
          `<button type="button" role="tab" ` +
          `${id ? `id="${esc(id)}-${esc(i.key)}"` : ''} ` +
          `${panelId || panelPrefix ? `aria-controls="${esc(panelFor(i.key))}"` : ''} ` +
          `data-tab-key="${esc(i.key)}" aria-selected="${i.key === active}" ` +
          `tabindex="${i.key === active ? 0 : -1}">${esc(i.label)}</button>`
      )
      .join('') +
    `</div>`
  );
}

/**
 * 页签的点击与键盘操作。
 *
 * 键盘要支持四个键，不能只做左右：Tab 进来后如果只能左右箭头，
 * 键盘用户就跳不出这一组。只有当前项 tabindex=0，其余 -1，
 * 这是 ARIA 页签的标准做法 —— Tab 键一次进来，方向键在组内移动。
 */
export function bindTabs(root, onSelect) {
  const buttons = [...root.querySelectorAll('[data-tab-key]')];

  function select(button) {
    buttons.forEach((b) => {
      b.setAttribute('aria-selected', String(b === button));
      b.tabIndex = b === button ? 0 : -1;
    });
    return onSelect(button.dataset.tabKey);
  }

  /** 方向键循环，Home/End 跳首尾。返回 null 表示这个键不归我管。 */
  const nextIndex = (key, i) => {
    if (key === 'ArrowRight') return (i + 1) % buttons.length;
    if (key === 'ArrowLeft') return (i + buttons.length - 1) % buttons.length;
    if (key === 'Home') return 0;
    if (key === 'End') return buttons.length - 1;
    return null;
  };

  buttons.forEach((b, i) => {
    b.onclick = () => select(b);
    b.onkeydown = (e) => {
      const next = nextIndex(e.key, i);
      if (next === null) return;
      e.preventDefault();
      buttons[next].focus();
      select(buttons[next]);
    };
  });
}
