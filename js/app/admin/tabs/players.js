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
import {$,api,post,patch,modal,region,field,status} from '../../core.js'
import { table, toolbar, bindList, params, attachExport, isSuper } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar(
    {
      options: ['pending','active'],
      create: isSuper()
        ? () =>
            modal(
              '建个市民账号',
              field('username', '游戏 ID') +
                field('email', '邮箱', 'email') +
                field('password', '起步密码', 'password'),
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
          ['username', '游戏 ID'],
          ['email', '邮箱'],
          ['emeralds', '💎'],
          ['status', '状态', status],
        ],
        d.players,
        [
          {
            key: 'audit',
            label: '经手记录',
            when: isSuper,
            run: (r) => viewAudit('players', r.id),
          },
          {
            key: 'approve',
            label: '批了',
            when: (r) => r.status !== 'active',
            run: async (r) => {
              await patch('/api/admin/players?id=' + r.id + '&action=approve');
              await load();
            },
          },
          {
            key: 'reject',
            label: '停用',
            when: (r) => r.status !== 'rejected',
            run: async (r) => {
              if (!confirm('停用之后这位市民就登不进来了，真要停？')) return;
              await patch('/api/admin/players?id=' + r.id + '&action=reject');
              await load();
            },
          },
          {
            key: 'reset',
            label: '重置密码',
            when: isSuper,
            run: async (r) =>
              modal(
                '重置密码',
                field('new_password', '新密码', 'password'),
                { submit: (d) => patch('/api/admin/players?id=' + r.id + '&action=reset', d) }
              ),
          },
          {
            key: 'rename',
            label: '改名',
            when: isSuper,
            run: async (r) =>
              modal(
                '改游戏 ID',
                field('new_username', '游戏 ID', 'text', r.username),
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