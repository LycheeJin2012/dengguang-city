// 「🤖 灯灯」个人助手浮窗。
//
// 结构：body 末尾挂两个元素 —— 一个 launcher 按钮，一个默认隐藏的 panel。
// panel 的 header 放标题、跳完整会话的链接、关闭按钮；剩下那块
// .assistant-window-content 挂 Shadow DOM。
//
// 为什么必须用 Shadow DOM：它不继承宿主样式表，所以里面得自己 <link> 一份
// 带版本号的 style.css —— 版本号漏 bump 的症状是「只有这个浮窗样式不更新」，
// 比全站漏 bump 更难从页面上看出来，tests/asset-version.test.js 盯着这条。
//
// 聊天区是懒加载的：整份 chat-page.js 只有用户真的打开浮窗时才会被 import。

import { state, login, region } from '../app/core.js';

export function mountAssistantWindow() {
  // 挂过一次就别再挂：entry.js 可能被多个入口 import 到
  if (document.querySelector('#assistant-launcher')) return;

  const launcher = document.createElement('button');
  launcher.id = 'assistant-launcher';
  launcher.type = 'button';
  launcher.textContent = '🤖 灯灯';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'assistant-window');

  const panel = document.createElement('section');
  panel.id = 'assistant-window';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '灯灯个人助手');
  // 拆成数组 join 只是为了排版，拼出来的字符串与旧的一字不差
  // （tests/assistant-window-equiv.test.js 逐字节比对着）
  panel.innerHTML = [
    '<header class="assistant-window-head">',
    '<strong>灯灯个人助手</strong>',
    '<a href="/messages.html?to=%E7%81%AF%E7%81%AF%E5%AE%A2%E6%9C%8D" aria-label="打开完整会话">↗</a>',
    '<button type="button" data-close-assistant aria-label="关闭灯灯浮窗">✕</button>',
    '</header>',
    '<div class="assistant-window-content"></div>',
  ].join('');

  const shadow = panel.querySelector('.assistant-window-content').attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<link rel="stylesheet" href="/css/style.css?v=89">',
    '<div class="assistant-embedded"></div>',
  ].join('');

  // owner：当前渲染的是哪个用户的会话；loaded：聊天页是否已经渲染成功
  let owner = null;
  let loaded = false;
  let loading = null;

  async function content() {
    await state.authPending;
    const id = state.session?.player?.id || null;
    // 同一个用户的聊天页已经在了，不用重画
    if (loaded && id === owner) return;
    // 正在加载就等它 —— 这里必须 return 那个 promise，调用方 await content()
    // 才能等到真正的加载完成
    if (loading) return loading;

    owner = id;
    const main = document.createElement('main');
    shadow.querySelector('.assistant-embedded').replaceChildren(main);

    // 没登录：只给一个登录引导，不 import 聊天页
    if (!id) {
      const p = document.createElement('p');
      p.textContent = '登录后使用灯灯个人助手';
      const button = document.createElement('button');
      button.textContent = '市民登录';
      button.onclick = async () => {
        await login();
        await content();
      };
      main.append(p, button);
      loaded = false;
      return;
    }

    // inert：加载期间整个 main 不可交互，避免用户对着半截 DOM 操作
    main.inert = true;
    loading = region(main, () => import('../app/chat-page.js'), (m, el) => m.renderChat(el, {
      assistantOnly: true,
      // 聊天页拿它判断自己该不该显示（比如停止计时、收起输入态）
      isVisible: () => !panel.hidden && state.session?.player?.id === owner,
    }));
    try {
      await loading;
      // 聊天页有没有真的渲染出输入框，决定了 loaded —— 渲染失败时下次还能重试
      loaded = !!main.querySelector('#send-form');
    } finally {
      main.inert = false;
      loading = null;
    }
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.onclick = async () => {
    if (!panel.hidden) {
      close();
      return;
    }
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    const closeButton = panel.querySelector('[data-close-assistant]');
    closeButton.focus();
    await content();
    // content() 是异步的：这期间用户可能已经自己关了浮窗，或者焦点已经挪到
    // 别处了。两种情况下都不该再抢焦点。
    if (!panel.hidden && document.activeElement === closeButton) {
      (shadow.querySelector('#send-form textarea') || shadow.querySelector('main>button'))?.focus();
    }
  };
  panel.querySelector('[data-close-assistant]').onclick = close;

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  document.body.append(panel, launcher);
}
