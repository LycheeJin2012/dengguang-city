/**
 * Admins tab.
 *
 * 管理员账号管理：增删 / 绑定市民 / 改密码。
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import {$,api,post,patch,del,modal,region,field,state} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  function edit(r = {}) {
    modal(
      r.id ? '改管理员' : '新添管理员',
      field('username', '账号', 'text', r.username || '') +
        field(
          r.id ? 'new_password' : 'password',
          r.id ? '新密码（留空不动旧的）' : '密码',
          'password',
          '',
          { required: !r.id }
        ) +
        field('role', '权限', 'select', r.role || 'admin', {
          options: ['admin', 'super'],
        }) +
        field(
          'specialties',
          '分管什么、擅长什么',
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
          ['username', '账号'],
          ['role', '权限'],
          ['linked_player_username', '绑市民'],
        ],
        d.admins,
        [
          { key: 'audit', label: '经手记录', run: (r) => viewAudit('admins', r.id) },
          { key: 'edit', label: '改一改', run: edit },
          {
            key: 'link',
            label: '绑定或解绑',
            run: (r) =>
              modal(
                '绑定的市民账号',
                field(
                  'player_id',
                  '市民 ID（留空即解绑）',
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
            label: '移除',
            danger: true,
            when: (r) => r.id !== state.session.user.id,
            run: async (r) => {
              if (confirm('这位管理员真要删掉？删了就找不回来了。')) {
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