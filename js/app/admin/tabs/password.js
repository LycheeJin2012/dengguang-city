/**
 * Password tab.
 *
 * 管理员账号安全：修改密码 / 添加通行密钥 / 管理通行密钥。
 * 该 tab 不走通用 toolbar + table 模板，因为没有列表，只有按钮面板。
 */

import { adminContext } from '../state.js';
import {$,$$,modal,field,post,toast,esc,empty} from '../../core.js'
import { action } from '../../core.js';
import { registerPasskey } from '../../security.js';

export async function render() {
  const view = adminContext.root.querySelector('#admin-view');
  view.innerHTML = `<div class="panel"><h2>${'账号安全'}</h2><p>${'这里改的是管理密码，不影响绑定的市民密码。'}</p><div class="actions"><button id="change-password">${'改密码'}</button><button id="admin-add-key">${'添一个通行密钥'}</button><button id="admin-list-keys">${'通行密钥'}</button></div></div>`;

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
          if (confirm('这个通行密钥真要撤？撤了就登不进来了。')) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.key });
            b.closest('.row').remove();
          }
        })
    );
  };
}