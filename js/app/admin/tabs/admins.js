/**
 * Admins tab.
 *
 * 管理员账号管理：增删 / 绑定市民 / 改密码。
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import {
  $,
  api,
  post,
  patch,
  del,
  modal,
  region,
  field,
  tr,
  state,
} from '../../core.js';
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  function edit(r = {}) {
    modal(
      tr(r.id ? '编辑管理员' : '新增管理员', r.id ? 'Edit administrator' : 'New administrator'),
      field('username', tr('账号', 'Username'), 'text', r.username || '') +
        field(
          r.id ? 'new_password' : 'password',
          tr(r.id ? '新密码（留空不改）' : '密码', r.id ? 'New password (optional)' : 'Password'),
          'password',
          '',
          { required: !r.id }
        ) +
        field('role', tr('角色', 'Role'), 'select', r.role || 'admin', {
          options: ['admin', 'super'],
        }) +
        field(
          'specialties',
          tr('职责与擅长事项', 'Responsibilities / specialties'),
          'text',
          r.specialties || '',
          { required: false, maxlength: 300 }
        ),
      {
        submit: async (d) => {
          if (!d.new_password) delete d.new_password;
          await (r.id
            ? patch('/api/admin/admins?id=' + r.id, d)
            : post('/api/admin/admins', d));
          await load();
        },
      }
    );
  }

  const load = () =>
    region($('#records', view), () => api('/api/admin/admins'), (d, box) => {
      attachExport(d.admins);
      table(
        box,
        [
          ['id', 'ID'],
          ['username', tr('账号', 'Username')],
          ['role', tr('角色', 'Role')],
          ['linked_player_username', tr('绑定市民', 'Linked citizen')],
        ],
        d.admins,
        [
          { key: 'audit', label: tr('操作记录', 'History'), run: (r) => viewAudit('admins', r.id) },
          { key: 'edit', label: tr('编辑', 'Edit'), run: edit },
          {
            key: 'link',
            label: tr('绑定/解绑', 'Link / unlink'),
            run: (r) =>
              modal(
                tr('关联市民账号', 'Link citizen account'),
                field(
                  'player_id',
                  tr('市民 ID（留空解绑）', 'Citizen ID (empty to unlink)'),
                  'number',
                  r.linked_player_id || '',
                  { required: false, min: 1 }
                ),
                {
                  submit: async (d) => {
                    await post(
                      '/api/init?action=admin-' + (d.player_id ? 'merge-account' : 'unmerge-account'),
                      {
                        admin_id: r.id,
                        player_id: d.player_id || r.linked_player_id,
                      }
                    );
                    await load();
                  },
                }
              ),
          },
          {
            key: 'delete',
            label: tr('删除', 'Delete'),
            danger: true,
            when: (r) => r.id !== state.session.user.id,
            run: async (r) => {
              if (confirm(tr('确定删除此管理员？', 'Delete this administrator?'))) {
                await del('/api/admin/admins?id=' + r.id);
                await load();
              }
            },
          },
        ]
      );
    });

  await bindList(load);
}