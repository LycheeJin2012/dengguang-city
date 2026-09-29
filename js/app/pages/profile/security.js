/**
 * Security tab within /profile.
 *
 * v79-4 拆分自原 profile.js 的 security()。负责：
 *   - 修改市民密码
 *   - 添加 / 验证 / 移除通行密钥
 *   - 列出当前会话（通过 renderSessions）
 *
 * 该 tab 是独立功能，密码 + WebAuthn 流程相对独立，
 * 因此拆到独立文件方便复用与测试。
 */

import { renderSessions } from '../../account-sessions.js';
import { registerPasskey, testPasskey } from '../../security.js';
import {$,$$,api,post,region,esc,date,empty,field,modal,action,toast} from '../../core.js'

export async function security(el) {
  el.innerHTML = `<h3>${'密码与通行密钥'}</h3><p>${'通行密钥是指纹、面容或设备 PIN 顶替密码登录，密码本身不会离开你的设备。丢了设备就在下面把密钥移除，换新设备重新加一把。'}</p><div class="actions"><button id="password-change">${'改密码'}</button><button id="add-passkey">＋ ${'加通行密钥'}</button></div><div id="keys" class="section"></div>`;
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
          if (d.new_password !== d.confirm)
            throw new Error('两次输的不一样');
          await post('/api/init?action=player-change-password', d);
          toast('密码已改好');
        },
      }
    );

  $('#add-passkey', el).onclick = () =>
    modal(
      '加一把通行密钥',
      field('name', '给设备起个名', 'text', '我的手机'),
      {
        submit: async (d) => {
          await registerPasskey(d.name);
          await security(el);
        },
      }
    );

  await region($('#keys', el), () => post('/api/init?action=passkey-list'), (d, box) => {
    box.innerHTML =
      (d.passkeys || [])
        .map(
          (k) =>
            `<div class="row row-head"><span>🔑 ${esc(k.name)} <small>${date(k.created_at)} · ${'上次用'} ${k.last_used_at ? date(k.last_used_at) : '还没用过'}</small></span><div class="actions"><button data-test="${k.id}">${'试一把'}</button><button data-delete="${k.id}" class="danger">${'移除'}</button></div></div>`
        )
        .join('') || empty('一把密钥都没有，加一把就能免密码登录。');
    $$('[data-test]', box).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          await testPasskey(Number(b.dataset.test));
          toast('验证通过，只是试了一下，账号和登录状态都没动');
          await security(el);
        })
    );
    $$('[data-delete]', box).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          if (confirm('移除后这台设备就不能再用密钥登录了，确定？')) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.delete });
            await security(el);
          }
        })
    );
  });
}