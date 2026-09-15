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
import {
  $,
  $$,
  api,
  post,
  region,
  tr,
  esc,
  date,
  empty,
  field,
  modal,
  action,
  toast,
} from '../../core.js';

export async function security(el) {
  el.innerHTML = `<h3>${tr('密码与通行密钥', 'Passwords and passkeys')}</h3><p>${tr(
    '使用 Touch ID、Face ID 或设备 PIN 安全登录。',
    'Sign in using Touch ID, Face ID, or your device PIN.'
  )}</p><div class="actions"><button id="password-change">${tr('修改密码', 'Change password')}</button><button id="add-passkey">＋ ${tr('添加通行密钥', 'Add passkey')}</button></div><div id="keys" class="section"></div>`;
  const sessionsBox = document.createElement('section');
  sessionsBox.className = 'section';
  el.append(sessionsBox);
  renderSessions(sessionsBox).catch((e) => {
    sessionsBox.textContent = e.message;
  });

  $('#password-change', el).onclick = () =>
    modal(
      tr('修改市民密码', 'Change citizen password'),
      field('old_password', tr('原密码', 'Current password'), 'password') +
        field('new_password', tr('新密码', 'New password'), 'password') +
        field('confirm', tr('确认新密码', 'Confirm password'), 'password'),
      {
        submit: async (d) => {
          if (d.new_password !== d.confirm)
            throw new Error(tr('两次密码不一致', 'Passwords do not match'));
          await post('/api/init?action=player-change-password', d);
          toast(tr('密码已修改', 'Password changed'));
        },
      }
    );

  $('#add-passkey', el).onclick = () =>
    modal(
      tr('添加通行密钥', 'Add passkey'),
      field('name', tr('设备名称', 'Device name'), 'text', 'My device'),
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
            `<div class="row row-head"><span>🔑 ${esc(k.name)} <small>${date(k.created_at)} · ${tr(
              '最近使用',
              'Last used'
            )} ${k.last_used_at ? date(k.last_used_at) : tr('尚未使用', 'Never')}</small></span><div class="actions"><button data-test="${k.id}">${tr(
              '验证此密钥',
              'Verify this key'
            )}</button><button data-delete="${k.id}" class="danger">${tr('移除', 'Remove')}</button></div></div>`
        )
        .join('') || empty(tr('还没有通行密钥', 'No passkeys yet'));
    $$('[data-test]', box).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          await testPasskey(Number(b.dataset.test));
          toast(tr('通行密钥验证通过，当前账号保持不变', 'Passkey verified; your account is unchanged'));
          await security(el);
        })
    );
    $$('[data-delete]', box).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          if (confirm(tr('移除此通行密钥？', 'Remove this passkey?'))) {
            await post('/api/init?action=passkey-delete', { id: +b.dataset.delete });
            await security(el);
          }
        })
    );
  });
}