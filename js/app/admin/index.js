/**
 * Admin workspace entry (v78+).
 *
 * 路由层：只负责 render / switchTab / loadActive + tab 文件路由。
 * 工具层（names / resources / refreshStats / table / toolbar / bindList / params /
 * attachExport / resourceList / signups / isSuper / canHandleTicket）在 shared.js。
 * 各 tab 实现在 tabs/*.js。
 *
 * 文件组织：
 *   - imports + setRouter 注入
 *   - tabHandlers：{ key → render(loadActive) } 映射
 *   - loadActive：根据 active 路由到 tab 文件 / 共享 tab 实现 / 外部模块
 *   - switchTab：tab 切换 + hash 同步
 *   - render：入口
 */

import { tabsMarkup, bindTabs } from '../../ui/workspace.js';
import { renderMapAdmin } from '../city-map.js';
import { renderSupportChat } from '../support-chat-admin.js';
import { renderReplyFeedback } from '../reply-feedback-admin.js';
import { renderExamReview } from '../exam-review.js';
import { renderKnowledge } from '../knowledge-admin.js';
import { renderAudit } from '../audit-ui.js';
import { navigationFor, resolveNavigation } from '../admin-navigation.js';
import { passkeyLogin } from '../security.js';
import { adminContext } from './state.js';
import {
  $,
  $$,
  api,
  post,
  esc,
  tr,
  title,
  field,
  modal,
  region,
  action,
  state,
  login,
  session,
  renderAccount,
} from '../core.js';
import {
  refreshStats,
  resourceList,
  signups,
  names,
  resources,
  isSuper,
  setRouter,
} from './shared.js';

// 各 tab 文件。dispatch 复用 tickets。
import { render as renderTickets } from './tabs/tickets.js';
import { render as renderPlayers } from './tabs/players.js';
import { render as renderAdmins } from './tabs/admins.js';
import { render as renderDms } from './tabs/dms.js';
import { render as renderTimes } from './tabs/times.js';
import { render as renderQuestions } from './tabs/questions.js';
import { render as renderPassword } from './tabs/password.js';
import { render as renderOwners } from './tabs/owners.js';

const tabHandlers = {
  tickets: renderTickets,
  dispatch: renderTickets, // dispatch 复用 tickets 视图，靠 adminContext.active 区分
  players: renderPlayers,
  admins: renderAdmins,
  dms: renderDms,
  times: renderTimes,
  questions: renderQuestions,
  password: renderPassword,
  owners: renderOwners,
};

export async function loadActive() {
  const page = adminContext.active;
  try {
    if (page === 'replyfeedback') await renderReplyFeedback(adminContext.view);
    else if (page === 'examreview') await renderExamReview(adminContext.view);
    else if (page === 'citymap') await renderMapAdmin(adminContext.view);
    else if (page === 'knowledge') await renderKnowledge(adminContext.view);
    else if (page === 'support') await renderSupportChat(adminContext.view);
    else if (page === 'audit') await renderAudit(adminContext.view);
    else if (resources[page]) await resourceList(resources[page], { reload: loadActive });
    else if (['bookings', 'kart', 'circuit', 'license'].includes(page))
      await signups(page, { reload: loadActive });
    else if (tabHandlers[page]) await tabHandlers[page](loadActive);
    else throw new Error(`unknown tab: ${page}`);
  } catch (e) {
    if (page === adminContext.active)
      adminContext.view.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
  }
}

export function switchTab(key) {
  const selected = resolveNavigation(key, isSuper());
  adminContext.active = selected.child;
  const menu = $('#admin-nav-toggle', adminContext.root);
  if (menu) {
    menu.textContent = tr(...selected.group.label);
    menu.setAttribute('aria-expanded', 'false');
    $('.admin-sidebar', adminContext.root).classList.remove('menu-open');
  }
  location.hash = adminContext.active;
  $$('.admin-nav [data-group]', adminContext.root).forEach((button) =>
    button.setAttribute('aria-selected', button.dataset.group === selected.group.id)
  );
  const section = document.createElement('section');
  section.className = 'admin-content';
  section.id = 'admin-section';
  if (selected.group.children.length > 1) {
    const tabs = document.createElement('div');
    tabs.innerHTML = tabsMarkup(
      selected.group.children.map((key) => ({ key, label: tr(...names[key]) })),
      adminContext.active,
      { id: 'admin-tabs', label: tr(...selected.group.label), panelId: 'admin-view' }
    );
    bindTabs(tabs, switchTab);
    section.append(tabs);
  }
  const next = document.createElement('section');
  next.id = 'admin-view';
  if (selected.group.children.length > 1) {
    next.setAttribute('role', 'tabpanel');
    next.setAttribute('aria-labelledby', 'admin-tabs-' + adminContext.active);
  }
  section.append(next);
  $('#admin-section', adminContext.root).replaceWith(section);
  adminContext.view = next;
  loadActive();
}

export async function render(el) {
  setRouter({ switchTab, loadActive });

  adminContext.root = el;
  if (!adminContext.historyBound) {
    window.addEventListener('hashchange', () => {
      const key = location.hash.slice(1);
      if (
        adminContext.root?.isConnected &&
        state.session?.admin &&
        resolveNavigation(key, isSuper()).child !== adminContext.active
      )
        switchTab(key);
    });
    adminContext.historyBound = true;
  }
  if (!state.session?.admin) {
    const player = state.session?.player;
    const linked = !!player?.linked_admin_id;
    el.innerHTML =
      title('市政管理后台', 'City administration') +
      `<div class="panel"><h2>${tr('通过绑定玩家账号辅助登录', 'Sign in with your linked citizen account')}</h2><p>${
        player
          ? esc(player.username) +
            ' · ' +
            tr(
              linked
                ? '已绑定管理员，可选择密码或通行密钥验证。'
                : '此玩家尚未绑定管理员账号，请切换到已绑定账号。',
              linked
                ? 'Linked administrator: verify with a password or passkey.'
                : 'This citizen has no linked administrator. Switch to a linked account.'
            )
          : tr(
              '先登录已绑定管理员的玩家账号，再验证管理员身份。',
              'Sign in to a linked citizen account, then verify administrator access.'
            )
      }</p><div class="actions">${
        linked
          ? `<button id="admin-enter" class="primary">${tr('使用管理员密码', 'Use admin password')}</button><button id="admin-passkey">${tr('使用通行密钥', 'Use passkey')}</button>`
          : `<button id="admin-player-login" class="primary">${tr('登录绑定玩家账号', 'Sign in to linked citizen')}</button>`
      }</div></div>`;
    $('#admin-player-login', el)?.addEventListener('click', async () => {
      await login(false, 'player', { hideRegistration: true });
      await session();
      renderAccount();
      render(el);
    });
    $('#admin-passkey', el)?.addEventListener('click', (e) =>
      action(e.currentTarget, async () => {
        await passkeyLogin('admin');
        await session();
        renderAccount();
        render(el);
      })
    );
    $('#admin-enter', el)?.addEventListener('click', () =>
      modal(
        tr('管理密码验证', 'Verify admin password'),
        field('admin_password', tr('管理密码', 'Admin password'), 'password'),
        {
          label: tr('验证并进入', 'Verify and enter'),
          submit: async (d) => {
            await post('/api/init?action=admin-enter-password', d);
            await session();
            renderAccount();
            render(el);
          },
        }
      )
    );
    return;
  }
  el.innerHTML =
    title('市政管理后台', 'City administration') +
    `<div class="section-head"><span>👤 ${esc(state.session.user.username)} <span class="badge">${esc(
      state.session.user.role.toUpperCase()
    )}</span></span><button id="refresh-stats">↻ ${tr('刷新概览', 'Refresh overview')}</button></div><div id="admin-stats"></div><div class="admin-layout" style="margin-top:28px"><aside class="admin-sidebar"><button type="button" id="admin-nav-toggle" aria-expanded="false" aria-controls="admin-navigation">${tr(
      '管理功能',
      'Administration'
    )}</button><nav id="admin-navigation" class="admin-nav" aria-label="${tr(
      '管理功能',
      'Administration'
    )}">${navigationFor(isSuper())
      .map(
        (group) =>
          `<button data-group="${group.id}" aria-selected="false">${tr(...group.label)}</button>`
      )
      .join('')}</nav></aside><section id="admin-section" class="admin-content"><section id="admin-view"></section></section></div>`;
  adminContext.view = $('#admin-view', el);
  $('#admin-nav-toggle', el).onclick = () => {
    const aside = $('.admin-sidebar', el);
    const open = aside.classList.toggle('menu-open');
    $('#admin-nav-toggle', el).setAttribute('aria-expanded', String(open));
  };
  $$('[data-group]', el).forEach((b) => (b.onclick = () => switchTab(b.dataset.group)));
  $('#refresh-stats', el).onclick = () => refreshStats(switchTab);
  refreshStats(switchTab);
  const key = location.hash.slice(1);
  switchTab(key || 'tickets');
}