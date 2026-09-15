/**
 * Password tab.
 *
 * 管理员账号安全：修改密码 / 添加通行密钥 / 管理通行密钥。
 * 该 tab 不走通用 toolbar + table 模板，因为没有列表，只有按钮面板。
 */

import { adminContext } from '../state.js';
import { $, $$, modal, field, post, toast, tr, esc, empty } from '../../core.js';
import { action } from '../../core.js';
import { registerPasskey } from '../../security.js';

export async function render() {
  const view = adminContext.root.querySelector('#admin-view');
  view.innerHTML = `<div class="panel"><h2>${tr(
    '管理员账号安全',
    'Administrator security'
  )}</h2><p>${tr(
    '修改管理密码不影响绑定的市民密码。',
    'Changing your admin password does not change your citizen password.'
  )}</p><div class="actions"><button id="change-password">${tr('修改密码', 'Change password')}</button><button id="admin-add-key">${tr(
    '添加通行密钥',
    'Add passkey'
  )}</button><button id="admin-list-keys">${tr('管理通行密钥', 'Manage passkeys')}</button></div></div>`;

  $('#change-password', view).onclick = () =>
    modal(
      tr('修改管理员密码', 'Change admin password'),
      field('old_password', tr('当前密码', 'Current password'), 'password') +
        field('new_password', tr('新密码', 'New password'), 'password') +
        field('confirm', tr('再次输入新密码', 'Confirm new password'), 'password'),
      {
        submit: async (d) => {
          if (d.new_password !== d.confirm)
            throw new Error(tr('两次密码不一致', 'Passwords do not match'));
          await post('/api/admin/change-password', d);
          toast(tr('密码已修改', 'Password changed'));
        },
      }
    );

  $('#admin-add-key', view).onclick = () =>
    modal(
      tr('添加通行密钥', 'Add passkey'),
      field('name', tr('设备名称', 'Device name'), 'text', 'Admin device'),
      {
        submit: async (d) => {
          await registerPasskey(d.name);
          toast(tr('已添加通行密钥', 'Passkey added'));
        },
      }
    );

  $('#admin-list-keys', view).onclick = async () => {
    const d = await post('/api/init?action=passkey-list');
    const dialog = modal(
      tr('管理通行密钥', 'Manage passkeys'),
      '<div class="wide">' +
        (d.passkeys
          .map(
            (k) =>
              `<div class="row row-head"><span>${esc(k.name)}</span><button type="button" data-key="${k.id}">${tr(
                '移除',
                'Remove'
              )}</button></div>`
          )
          .join('') || empty()) +
        '</div>'
    );
    $$('[data-key]', dialog).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          if (confirm(tr('移除此通行密钥？', 'Remove this passkey?'))) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.key });
            b.closest('.row').remove();
          }
        })
    );
  };
}