/**
 * 账号安全 tab（password）。
 *
 * 管理员改密码 / 添通行密钥 / 看已登记的通行密钥。
 *
 * 这个 tab 不走 shared.js 的 toolbar + table 模板 —— 它没有列表，
 * 只是一块按钮面板。三块功能各自独立，互不影响。
 *
 * 两个不能改的行为：
 *   - 改密码要求「新密码」和「确认」一致，不一致直接抛错，不发请求
 *   - 撤通行密钥前要 confirm：这是**不可逆**的，撤了就登不进来
 */

import { adminContext } from '../state.js';
import {$,$$,modal,field,post,toast,esc,empty} from '../../core.js'
import { action } from '../../core.js';
import { registerPasskey } from '../../security.js';

export async function render() {
  const view = adminContext.root.querySelector('#admin-view');
  view.innerHTML =
    `<div class="panel"><h2>${'账号安全'}</h2>` +
    `<p>${'这里改的是管理密码，不影响绑定的市民密码。'}</p>` +
    `<div class="actions">` +
    `<button id="change-password">${'改密码'}</button>` +
    `<button id="admin-add-key">${'添一个通行密钥'}</button>` +
    `<button id="admin-list-keys">${'通行密钥'}</button>` +
    `</div></div>`;

  // 改管理密码。要先输旧的；两次新密码不一致就别浪费一次请求
  $('#change-password', view).onclick = () =>
    modal(
      '改管理密码',
      field('old_password', '当前密码', 'password') +
        field('new_password', '新密码', 'password') +
        field('confirm', '再输一遍新密码', 'password'),
      {
        submit: async (d) => {
          if (d.new_password !== d.confirm)
            throw new Error('两次输的不一样');
          await post('/api/admin/change-password', d);
          toast('密码改好了');
        },
      }
    );

  // 登记新的通行密钥。名字只是给人看的标签，默认给一个中性值
  $('#admin-add-key', view).onclick = () =>
    modal(
      '添一个通行密钥',
      field('name', '这台设备叫', 'text', 'Admin device'),
      {
        submit: async (d) => {
          await registerPasskey(d.name);
          toast('通行密钥添好了');
        },
      }
    );

  // 已登记的密钥列表 + 逐个撤销
  $('#admin-list-keys', view).onclick = async () => {
    const d = await post('/api/init?action=passkey-list');
    const dialog = modal(
      '通行密钥',
      '<div class="wide">' +
        (d.passkeys
          .map(
            (k) =>
              `<div class="row row-head"><span>${esc(k.name)}</span><button type="button" data-key="${k.id}">${'移除'}</button></div>`
          )
          .join('') || empty()) +
        '</div>'
    );
    $$('[data-key]', dialog).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          // 不可逆操作，最后一道人工确认
          if (confirm('这个通行密钥真要撤？撤了就登不进来了。')) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.key });
            // 撤掉一行就行，不必重开列表
            b.closest('.row').remove();
          }
        })
    );
  };
}
