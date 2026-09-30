/**
 * 账号与登录（/profile 的 security tab）。
 *
 * 原来这个文件 79 行、最长行 417 字符：一根模板串画完整个 tab，每把通行密钥的
 * 「试一把 / 移除」按钮绑定又各写一遍。现在按「骨架 / 密钥列表 / 三个弹窗」拆开。
 *
 * 不能改的行为：
 *   1. 改完密码、加完密钥、试完密钥、删完密钥之后都是 `await security(el)` 整段
 *      重画，而不是局部更新。这样最省事也最不容易漏刷新，但注意：重画会重新
 *      调一次 `renderSessions`，也就是会话列表会重新拉一次。保持原样。
 *   2. `renderSessions` 是 fire-and-forget（不 await），失败时把错误消息写进
 *      容器里，而不是抛出去 —— 因为它只是页面下方的一块附属区，不能因为
 *      会话接口挂了就把整个 tab 弄白。
 * 3. 移除密钥走原生 `confirm`，取消时什么都不做。这里不要换成 modal。
 *   4. 「试一把」只是验证密钥可用性，**不会**改变登录状态，提示语原文如此。
 *   5. 密钥列表的数据来自 `post('/api/init?action=passkey-list')` —— 是 POST
 *      不是 GET，别"顺手改成" /api/passkeys。
 */

import { renderSessions } from '../../account-sessions.js';
import { registerPasskey, testPasskey } from '../../security.js';
import { $, $$, api, post, region, esc, date, empty, field, modal, action, toast } from '../../core.js';

/** tab 骨架：说明 + 两个按钮 + 密钥列表槽 */
function tabMarkup() {
  return (
    '<h3>密码与通行密钥</h3>' +
    '<p>通行密钥是指纹、面容或设备 PIN 顶替密码登录，密码本身不会离开你的设备。' +
    '丢了设备就在下面把密钥移除，换新设备重新加一把。</p>' +
    '<div class="actions">' +
    '<button id="password-change">改密码</button>' +
    '<button id="add-passkey">＋ 加通行密钥</button></div>' +
    '<div id="keys" class="section"></div>'
  );
}

/** 一把通行密钥的一行 */
function keyRow(k) {
  const used = k.last_used_at ? date(k.last_used_at) : '还没用过';
  return (
    '<div class="row row-head"><span>🔑 ' + esc(k.name) +
    ` <small>${date(k.created_at)} · 上次用 ${used}</small></span>` +
    '<div class="actions">' +
    `<button data-test="${k.id}">试一把</button>` +
    `<button data-delete="${k.id}" class="danger">移除</button>` +
    '</div></div>'
  );
}

export async function security(el) {
  el.innerHTML = tabMarkup();

  // 会话列表挂在密钥区下面。故意不 await：这块挂了不影响上面的密码 / 密钥功能
  const sessionsBox = document.createElement('section');
  sessionsBox.className = 'section';
  el.append(sessionsBox);
  renderSessions(sessionsBox).catch((e) => {
    sessionsBox.textContent = e.message;
  });

  $('#password-change', el).onclick = () =>
    modal(
      '改密码',
      field('old_password', '现在的密码', 'password') +
        field('new_password', '新密码', 'password') +
        field('confirm', '再输一遍', 'password'),
      {
        submit: async (d) => {
          if (d.new_password !== d.confirm) throw new Error('两次输的不一样');
          await post('/api/init?action=player-change-password', d);
          toast('密码已改好');
        },
      }
    );

  $('#add-passkey', el).onclick = () =>
    modal('加一把通行密钥', field('name', '给设备起个名', 'text', '我的手机'), {
      submit: async (d) => {
        await registerPasskey(d.name);
        await security(el);
      },
    });

  await region($('#keys', el), () => post('/api/init?action=passkey-list'), (d, box) => {
    box.innerHTML =
      (d.passkeys || []).map(keyRow).join('') || empty('一把密钥都没有，加一把就能免密码登录。');

    $$('[data-test]', box).forEach((b) => {
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          // 只做验证，不动账号和登录状态
          await testPasskey(Number(b.dataset.test));
          toast('验证通过，只是试了一下，账号和登录状态都没动');
          await security(el);
        });
    });

    $$('[data-delete]', box).forEach((b) => {
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          if (confirm('移除后这台设备就不能再用密钥登录了，确定？')) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.delete });
            await security(el);
          }
        });
    });
  });
}
