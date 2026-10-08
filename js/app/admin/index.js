/**
 * 管理后台入口：路由层。
 *
 * 只管三件事：render()（画骨架）、switchTab()（换页 + 同步 hash）、
 * loadActive()（把当前 active 分发到对应的 tab 实现）。具体的 tab 干什么
 * 不在这里。
 *
 * loadActive 的分发顺序是有讲究的，**不要随手重排**：
 *   1. 先认外面独立模块的 tab（replyfeedback / citymap / knowledge …）
 *   2. 再认 resources 数据表驱动的通用列表（tracks / hotels / gallery …）
 *   3. 再认报名类（bookings / kart / circuit / license）
 *   4. 最后才是 tabs/ 下的自有实现
 * 前面几类先判，是为了防止某个 key 同时出现在两处时落到「更特殊但不该走」
 * 的那个分支上。
 *
 * 三处不能改的行为：
 *   - catch 里要重新比对 page === adminContext.active。切页过程中旧请求失败，
 *     如果不比对就会把「已经切走的页面」覆写成错误提示
 *   - hashchange 监听只绑一次（historyBound）。重复绑会让一次切页触发多次渲染
 *   - 未登录时先渲染「借玩家账号进后台」，三个入口都走 session() + renderAccount()
 *     + render(el) 的固定三步，漏一步会出现「进了后台但顶栏还是游客」
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
import {$,$$,api,post,esc,title,field,modal,region,action,state,login,session,renderAccount} from '../core.js'
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
import { render as renderAiHealth } from './tabs/aihealth.js';

/**
 * tab key → 渲染函数。
 * dispatch 指向同一个 renderTickets，靠 adminContext.active === 'dispatch'
 * 让它切出派单视角（预设筛选 + 顶上插派单规矩面板）。
 */
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
  aihealth: renderAiHealth,
};

/** 分发到报名类通用 tab 的 key。 */
const SIGNUP_PAGES = ['bookings', 'kart', 'circuit', 'license'];

export async function loadActive() {
  const page = adminContext.active;
  try {
    // 顺序见文件头注释：外部模块 → resources → 报名 → tabs/
    if (page === 'replyfeedback') await renderReplyFeedback(adminContext.view);
    else if (page === 'examreview') await renderExamReview(adminContext.view);
    else if (page === 'citymap') await renderMapAdmin(adminContext.view);
    else if (page === 'knowledge') await renderKnowledge(adminContext.view);
    else if (page === 'support') await renderSupportChat(adminContext.view);
    else if (page === 'audit') await renderAudit(adminContext.view);
    else if (resources[page]) await resourceList(resources[page], { reload: loadActive });
    else if (SIGNUP_PAGES.includes(page)) await signups(page, { reload: loadActive });
    else if (tabHandlers[page]) await tabHandlers[page](loadActive);
    else throw new Error(`unknown tab: ${page}`);
  } catch (e) {
    // 用户可能在等这个请求的时候已经切到别的页去了。只有还停在原来这页
    // 才把错误画上去，否则会把新页内容冲掉
    if (page === adminContext.active)
      adminContext.view.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
  }
}

/**
 * 切到某个 tab（或某个分组）。
 *
 * key 既可以是分组 id 也可以是子项 key，resolveNavigation 负责归一。
 * 除了换内容，这里还负责三件「不能漏」的事：收导航抽屉、改 aria-selected、
 * 同步 location.hash —— 少了 hash，刷新就回不到刚才那页。
 */
export function switchTab(key) {
  const selected = resolveNavigation(key, isSuper());
  adminContext.active = selected.child;

  // 移动端导航是个抽屉。切页后顺手收起来并把 aria 归位，
  // 不然点在子项上抽屉还盖着内容
  const menu = $('#admin-nav-toggle', adminContext.root);
  if (menu) {
    menu.textContent = selected.group.label;
    menu.setAttribute('aria-expanded', 'false');
    $('.admin-sidebar', adminContext.root).classList.remove('menu-open');
  }
  location.hash = adminContext.active;
  $$('.admin-nav [data-group]', adminContext.root).forEach((button) =>
    button.setAttribute('aria-selected', button.dataset.group === selected.group.id)
  );

  // 整个 #admin-section 换掉：分组变了，tab 栏的构成也变了，
  // 局部改不如重建，省得漏掉上一个分组留下的节点
  const section = document.createElement('section');
  section.className = 'admin-content';
  section.id = 'admin-section';

  // 只有多子项的分组才需要 tab 栏。单子项分组直接一个面板
  if (selected.group.children.length > 1) {
    const tabs = document.createElement('div');
    tabs.innerHTML = tabsMarkup(
      selected.group.children.map((key) => ({ key, label: names[key] })),
      adminContext.active,
      { id: 'admin-tabs', label: selected.group.label, panelId: 'admin-view' }
    );
    bindTabs(tabs, switchTab);
    section.append(tabs);
  }

  const next = document.createElement('section');
  next.id = 'admin-view';
  // 同样只在有 tab 栏时才补 ARIA 角色，否则会指向不存在的 tablist
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
  // 注入路由：shared.js 里的工具要靠它换页/重载。不在 import 时做，
  // 是为了避开 shared.js ↔ index.js 的循环依赖
  setRouter({ switchTab, loadActive });

  adminContext.root = el;
  if (!adminContext.historyBound) {
    // 只绑一次。hash 被别人改（手输、浏览器前进后退）时跟着切页，
    // 但要先确认目标页确实变了，否则 render 初始化时自己写 hash 会打转
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
    renderEntryGate(el);
    return;
  }

  el.innerHTML = title('市政后台') + adminShellHtml();
  adminContext.view = $('#admin-view', el);

  // 移动端导航抽屉开合
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

/**
 * 已登录的后台骨架：顶栏 + 仪表盘 + 左侧分组导航 + 内容区。
 * 单独拆出来是因为这段 HTML 很长，压在 render() 里会盖住真正的逻辑。
 */
function adminShellHtml() {
  const role = state.session.user.role.toUpperCase();
  const navButtons = navigationFor(isSuper())
    .map(
      (group) =>
        `<button data-group="${group.id}" aria-selected="false">${group.label}</button>`
    )
    .join('');

  return (
    `<div class="section-head">` +
    `<span>👤 ${esc(state.session.user.username)} <span class="badge">${esc(role)}</span></span>` +
    `<button id="refresh-stats">↻ 再看一眼</button>` +
    `</div>` +
    `<div id="admin-stats"></div>` +
    `<div class="admin-layout stack-top-xl">` +
    `<aside class="admin-sidebar">` +
    `<button type="button" id="admin-nav-toggle" aria-expanded="false" aria-controls="admin-navigation">功能清单</button>` +
    `<nav id="admin-navigation" class="admin-nav" aria-label="功能清单">${navButtons}</nav>` +
    `</aside>` +
    `<section id="admin-section" class="admin-content"><section id="admin-view"></section></section>` +
    `</div>`
  );
}

/**
 * 没登录管理员身份时的「借玩家账号进后台」页。
 *
 * 三种入口：管理密码、通行密钥、或回到玩家登录页。三者成功后都走同一套
 * 收尾：session() 刷新登录态 → renderAccount() 重画顶栏 → render(el) 重画整页。
 * 少任何一步都会留下不一致的界面（比如顶栏还显示游客）。
 */
function renderEntryGate(el) {
  const player = state.session?.player;
  // 市民绑了管理员身份才进得去。没绑的话下面的「玩家登录」也是白搭，
  // 所以只给一条换账号的提示
  const linked = !!player?.linked_admin_id;

  const hint = player
    ? esc(player.username) +
      ' · ' +
      (linked
        ? '这位市民已经绑了管理员身份，用密码或通行密钥都能进。'
        : '这位市民还没绑管理员，换一个绑过的账号再来。')
    : '先登一个绑定了管理员的市民账号，再验管理员身份。';

  el.innerHTML =
    title('市政后台') +
    `<div class="panel"><h2>借玩家账号进后台</h2><p>${hint}</p><div class="actions">${
      linked
        ? `<button id="admin-enter" class="primary">用管理密码进</button><button id="admin-passkey">用通行密钥进</button>`
        : `<button id="admin-player-login" class="primary">登录绑定的市民账号</button>`
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
    modal('对一下管理密码', field('admin_password', '管理密码', 'password'), {
      label: '进去',
      submit: async (d) => {
        await post('/api/init?action=admin-enter-password', d);
        await session();
        renderAccount();
        render(el);
      },
    })
  );
}