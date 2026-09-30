/**
 * 前端公共底座。全站 51 个模块都从这里取东西，改这里的导出等于改全站。
 *
 * v88.6 重构：原来这个文件是「手工压缩」写法 —— 逻辑全挤在一行里，
 * 对象字面量被拆成十几行（`const x={a:1}` 写成 `const x={\na:1\n}`），
 * 读起来比压缩后的还难。本文件现在只是把它还原成正常代码，
 * **导出名单、函数签名、所有 HTML 字符串逐字未动**。
 *
 * 这里面有几处是「看着能简化，简化就出 bug」的，动手前先读一遍注释。
 */

import { escapeHtml } from '../ui/html.js';
import { formField } from '../ui/form-field.js';
import { openDialog } from '../ui/dialog.js';
import { mountWorkspace, pageHeading } from '../ui/workspace.js';
import { canSeeMunicipalLink, canSeeHotelOwnerLink } from './permissions.js';
import { parseDate } from '../date.js';

// ---------- DOM 取物 ----------

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = escapeHtml;

/** 登录态。全站唯一的一份，`session()` 负责刷新。 */
export const state = { session: null };

// ---------- 展示层小工具 ----------

export const date = value => {
  const d = parseDate(value);
  return Number.isFinite(+d) ? d.toLocaleString('zh-CN', { hour12: false }) : '—';
};

export const text = value => `<span class="prewrap">${esc(value)}</span>`;

/**
 * 只放行 http/https。用来渲染用户填的链接，挡掉 `javascript:` 这类协议。
 * 相对路径会按当前页解析成绝对地址。
 */
export const linkUrl = value => {
  try {
    const u = new URL(value, location.href);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
};

export const imageUrl = value => {
  // 展示层兜底：公告 / 房型缺图时不能渲染成 /null 或 /undefined。
  // 空值要在这里短路掉，不能交给 linkUrl —— 否则 <img> 会拿到一个
  // 指向当前页的 src，图裂了还会把版面撑开。
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (trimmed === '') return '';
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(trimmed)) return trimmed;
  return linkUrl(trimmed);
};

const STATUS_LABELS = {
  pending: '排队中', active: '在用', rejected: '没通过', approved: '批了', confirmed: '定下了',
  completed: '办完了', passed: '考过了', failed: '没考过', open: '待受理', in_progress: '在办',
  resolved: '有结果了', closed: '结案', unread: '没看', read: '看过了', done: '归档',
};

export function status(value) {
  return `<span class="badge ${esc(value)}">${esc(STATUS_LABELS[value] || value || '—')}</span>`;
}

const OPTION_LABELS = {
  pending: '排队中', active: '在用', rejected: '没通过', approved: '批了', confirmed: '定下了',
  completed: '办完了', cancelled: '撤了', passed: '考过了', failed: '没考过', open: '待受理',
  in_progress: '在办', resolved: '有结果了', closed: '结案',
  low: '不急', normal: '一般', high: '要紧', urgent: '十万火急',
  written: '笔试', road: '路考', upgrade: '换证考',
  choice: '单选', multi: '多选', judge: '判断',
  admin: '管理员', super: '超管',
};

export function optionLabel(value) {
  return OPTION_LABELS[value] || value;
}

/** 工单正文可能是结构化 JSON，按业务类型翻译成中文键值对 */
const TICKET_BODY_LABELS = {
  name: '姓名', contact: '联系方式', room_name: '房型', in_date: '入住', out_date: '退房',
  nights: '晚数', persons: '入住人数', breakfast: '早餐',
  session: '场次', exam_session: '考试场次', exam_type: '考试', exam_date: '考试日期',
  car: '车型', license: '驾照', note: '备注',
};

export function ticketBody(value) {
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    return text(value);
  }
  // 解析成功不等于形状对：数组、字符串、null 都当纯文本处理
  if (!data || Array.isArray(data) || typeof data !== 'object') return text(value);

  return Object.entries(data)
    .filter(([key, v]) =>
      Object.prototype.hasOwnProperty.call(TICKET_BODY_LABELS, key) && v !== null && v !== ''
    )
    .map(([key, v]) =>
      `<p><b>${TICKET_BODY_LABELS[key]}：</b>${text(key === 'breakfast' ? (v ? '含' : '不含') : optionLabel(v))}</p>`
    )
    .join('') || text('详情请查看对应业务记录');
}

// ---------- 网络 ----------

/** 20 秒兜底超时。上层给的 signal 也能提前中断（比如页面切走了）。 */
const REQUEST_TIMEOUT_MS = 20000;

export async function api(path, { method = 'GET', body, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 网关返回的可能是 HTML（502 页面），.json() 会抛；这里吞成 null，
    // 让下面统一的错误分支去给用户看人话
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || data.ok === false) {
      const e = new Error(data?.error || '市政厅这会儿联系不上，稍后再试');
      e.status = r.status;
      throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('等太久了，这次没赶上，再试一次');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const del = p => api(p, { method: 'DELETE' });

/**
 * 刷新登录态。
 * 一个细节：管理员带着 session 打开普通页面时，先悄悄把管理员身份登出，
 * 再重新取一次 —— 否则普通页面会一直以管理员视角渲染。
 */
export async function session() {
  try {
    state.session = await api('/api/login');
    if (state.session?.admin && typeof document !== 'undefined' && document.body?.dataset.page !== 'admin') {
      await post('/api/init?action=admin-logout', {});
      state.session = await api('/api/login');
    }
  } catch (e) {
    state.session = null;
    if (e.status !== 401) throw e;
  }
  return state.session;
}

// ---------- 反馈与占位 ----------

export function toast(message, error = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.className = error ? 'toast error' : 'toast';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.remove(), 5000);
}

export const empty = (message = '这里还空着') => `<div class="empty"><span aria-hidden="true">◇</span><p>${esc(message)}</p></div>`;

/**
 * 加载 → 渲染的固定套路，带 loading 态、失败重试和**竞态防护**。
 *
 * token 是这里的关键：连续两次 region() 打在同一个元素上时，
 * 慢的那次回来会被 `el._load !== token` 挡掉，不会覆盖新内容。
 */
export async function region(el, load, render) {
  if (!el) return;
  const token = Symbol();
  el._load = token;
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = `<p class="loading" role="status">${'正在取…'}</p>`;
  try {
    const d = await load();
    if (el._load !== token || !el.isConnected) return;
    el.innerHTML = '';
    await render(d, el);
  } catch (e) {
    if (el._load !== token || !el.isConnected) return;
    el.innerHTML = `<div class="empty error" role="alert"><p>${esc(e.message)}</p><button type="button" data-retry>${'再试一次'}</button></div>`;
    $('[data-retry]', el).onclick = () => region(el, load, render);
  } finally {
    if (el._load === token) el.removeAttribute('aria-busy');
  }
}

/** 包住按钮的异步动作：禁用 + 文案变「正在办…」+ 出错弹 toast + 复原 */
export async function action(button, fn) {
  if (button?.disabled) return;
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = '正在办…';
  }
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    // 复原前先确认按钮还在文档里 —— 动作可能把整个区块换掉了
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

// ---------- 表单与弹窗（转发给 ui/ 原语） ----------

export function field(name, label, type = 'text', value = '', opts = {}) {
  return formField(name, label, type, value, { ...opts, optionLabel });
}

export function modal(...args) {
  return openDialog({ $, $$, esc }, ...args);
}

// ---------- 登录 ----------

export async function requirePlayer() {
  // entry.js 在启动时把登录请求挂在这里，这里等它，避免并发拉两次
  await state.authPending;
  if (!state.session?.player) {
    await login();
    await session();
    if (!state.session?.player) throw new Error('请先登录市民账号');
  }
  return state.session.player;
}

export function login(register = false, target = 'player', options = {}) {
  return new Promise(resolve => {
    const dialog = modal(
      target === 'hotel_owner' ? '客栈老板入口' : register ? '申请成为市民' : '进入灯光市',
      field('username', '游戏 ID')
        + (register ? field('email', '邮箱', 'email') : '')
        + field('password', '密码', 'password')
        + `<div class="wide actions">${target === 'player' && !options.hideRegistration ? `<button type="button" id="auth-switch">${register ? '已有账号，直接登录' : '还没账号，去登记'}</button>` : ''}${register || target === 'hotel_owner' ? '' : `<button type="button" id="auth-passkey">用通行密钥登录</button>`}</div>`,
      {
        label: register ? '提交申请' : '进入',
        submit: async d => {
          await post(register ? '/api/register' : '/api/login', { ...d, target });
          if (register) toast('申请已递交，等市政厅看过就放行');
          else {
            await session();
            renderAccount();
            toast('欢迎回来');
          }
        },
      }
    );

    $('#auth-switch', dialog)?.addEventListener('click', () => {
      dialog.close();
      login(!register);
    });

    $('#auth-passkey', dialog)?.addEventListener('click', e =>
      action(e.currentTarget, async () => {
        // 通行密钥的依赖较大，按需加载，不进首屏
        const { passkeyLogin } = await import('./security.js');
        await passkeyLogin(target);
        await session();
        renderAccount();
        dialog.close();
      })
    );

    dialog.addEventListener('close', resolve, { once: true });
  });
}

// ---------- 页头 / 页脚 ----------

/** 导航项 + 当前页高亮。链接可见性由 permissions.js 按登录态决定。 */
function navigationMarkup() {
  const links = [
    ['/', '市政厅'],
    ['/hotel.html', '树上酒店'],
    ['/map.html', '城市地图'],
    ['/affairs.html', '我的事务'],
    ['/messages.html', '消息中心'],
  ];
  if (canSeeMunicipalLink(state.session)) links.push(['/admin.html', '市政后台']);
  if (canSeeHotelOwnerLink(state.session)) links.push(['/hotel-owner.html', '我的客栈']);

  return links
    .map(([href, zh]) => {
      const current = location.pathname.replace(/\.html$/, '').replace(/\/$/, '').replace('/admin-v37', '/admin');
      const target = href.replace(/\.html$/, '').replace(/\/$/, '');
      return `<a href="${href}" ${current === target ? 'aria-current="page"' : ''}>${zh}</a>`;
    })
    .join('');
}

export function renderAccount() {
  const navigation = $('#navigation');
  if (navigation) navigation.innerHTML = navigationMarkup();

  const slot = $('#account');
  if (!slot) return;

  const p = state.session?.player;
  const a = state.session?.admin || state.session?.user;

  slot.innerHTML = state.session
    ? `${p ? `<a href="/profile.html">👤 ${esc(p.username)}</a><span class="balance">💎 ${Number(p.emeralds) || 0}</span>` : `<span>${esc(a?.username)}</span>`}<button id="logout">离开</button>`
    : `<button id="login" class="primary">我是市民</button>`;

  // 首页的联系表单顺手预填，不覆盖玩家自己已经敲的内容
  const contact = $('#contact-form');
  if (p && contact) {
    for (const [key, val] of [['name', p.username], ['contact', p.email]]) {
      const input = $('[name=' + key + ']', contact);
      if (input && !input.value) input.value = val || '';
    }
  }

  $('#login')?.addEventListener('click', () => login());
  $('#logout')?.addEventListener('click', e =>
    action(e.currentTarget, async () => {
      await del('/api/login');
      location.href = '/';
    })
  );
}

export function shell() {
  document.documentElement.lang = 'zh-CN';
  document.documentElement.style.colorScheme = 'light';

  $('#header').innerHTML = `<div class="header-inner"><a class="brand" href="/"><span class="grass-block" aria-hidden="true"></span><span><strong>灯光市人民政府</strong><small>LIGHT CITY · EST. 2023</small></span></a><button id="menu" aria-expanded="false" aria-controls="navigation">☰ 菜单</button><div id="account"></div></div>`;

  mountWorkspace(navigationMarkup(), '主要导航');

  $('#menu').onclick = () => {
    const open = $('#navigation').classList.toggle('open');
    document.querySelector('.site-rail').classList.toggle('is-open', open);
    $('#menu').setAttribute('aria-expanded', open);
  };

  renderAccount();

  $('#footer').innerHTML = `<div><b>灯光市 · 由市民共建</b><p>Minecraft 城市作品展示，与 Mojang / Microsoft 无关。</p></div><a href="/#contact">联系市政厅 ↗</a>`;
}

/** 设置文档标题 + 返回页头大标题 HTML */
export function title(zh) {
  document.title = zh + ' · ' + '灯光市';
  return pageHeading(zh, 'LIGHT CITY');
}

// ---------- 导出 ----------

/**
 * 触发下载前先把这次导出记进台账。记账失败就直接中止 ——
 * 宁可不让导，也不要留下一份没台账的文件。
 */
export async function download(name, content, type = 'text/plain') {
  try {
    await post('/api/ui-events', {
      events: [{ action: 'export', page: location.pathname, element: 'download', label: name }],
    });
  } catch (e) {
    toast('这次导出没能记入台账，请重试', true);
    return;
  }

  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function csv(name, rows) {
  if (!rows.length) return toast('没东西可以导出');
  const keys = Object.keys(rows[0]);

  // 两个防护：
  //   1) 行首的 = + - @ 在 Excel / Numbers 里会被当公式执行（CSV 注入）
  //   2) 字段里的引号要翻倍
  const cell = v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';

  await download(
    name,
    // \ufeff 是 BOM，没有它 Excel 打开中文全是乱码
    '\ufeff' + [keys, ...rows.map(r => keys.map(k => r[k]))]
      .map(r => r.map(cell).join(','))
      .join('\r\n'),
    'text/csv;charset=utf-8'
  );
}
