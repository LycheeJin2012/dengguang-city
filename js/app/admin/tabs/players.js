/**
 * Players tab.
 *
 * 市民管理：批准 / 停用 / 重置密码 / 改名（仅 super）。
 *
 * 列格式与 actions 约定见 ../shared.js#table：
 *   - columns: [key, label] | [key, label, format(value, row)?]
 *   - actions: { key, label, when?, run(row), danger? }
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import { $, api, post, patch, modal, region, field, tr, status } from '../../core.js';
import { table, toolbar, bindList, params, attachExport, isSuper } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar(
    {
      options: ['pending', 'active', 'rejected'],
      create: isSuper()
        ? () =>
            modal(
              tr('创建市民账号', 'Create citizen'),
              field('username', tr('游戏 ID', 'Game ID')) +
                field('email', tr('邮箱', 'Email'), 'email') +
                field('password', tr('初始密码', 'Initial password'), 'password'),
              {
                submit: async (d) => {
                  await post('/api/init?action=admin-player-create', d);
                  await load();
                },
              }
            )
        : null,
    },
    () => loadActive()
  );
  const load = () =>
    region($('#records', view), () => api('/api/admin/players?' + params()), (d, box) => {
      attachExport(d.players);
      table(
        box,
        [
          ['id', 'ID'],
          ['username', tr('游戏 ID', 'Game ID')],
          ['email', tr('邮箱', 'Email')],
          ['emeralds', '💎'],
          ['status', tr('状态', 'Status'), status],
        ],
        d.players,
        [
          {
            key: 'audit',
            label: tr('操作记录', 'History'),
            when: isSuper,
            run: (r) => viewAudit('players', r.id),
          },
          {
            key: 'approve',
            label: tr('批准', 'Approve'),
            when: (r) => r.status !== 'active',
            run: async (r) => {
              await patch('/api/admin/players?id=' + r.id + '&action=approve');
              await load();
            },
          },
          {
            key: 'reject',
            label: tr('停用', 'Disable'),
            when: (r) => r.status !== 'rejected',
            run: async (r) => {
              if (!confirm(tr('停用此市民账号？', 'Disable this account?'))) return;
              await patch('/api/admin/players?id=' + r.id + '&action=reject');
              await load();
            },
          },
          {
            key: 'reset',
            label: tr('重置密码', 'Reset password'),
            when: isSuper,
            run: async (r) =>
              modal(
                tr('重置密码', 'Reset password'),
                field('new_password', tr('新密码', 'New password'), 'password'),
                { submit: (d) => patch('/api/admin/players?id=' + r.id + '&action=reset', d) }
              ),
          },
          {
            key: 'rename',
            label: tr('改名', 'Rename'),
            when: isSuper,
            run: async (r) =>
              modal(
                tr('修改游戏 ID', 'Rename'),
                field('new_username', tr('游戏 ID', 'Game ID'), 'text', r.username),
                {
                  submit: async (d) => {
                    await patch('/api/admin/players?id=' + r.id + '&action=rename', d);
                    await load();
                  },
                }
              ),
          },
        ]
      );
    });
  await bindList(load);
}