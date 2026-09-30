/**
 * 市民管理 tab（players）。
 *
 * 批准 / 停用 / 重置密码 / 改名 / 建号。
 *
 * 权限是分层的，别看混：
 *   - 所有管理员都能「批了」「停用」—— 这是日常受理
 *   - 建号、经手记录、重置密码、改名只有超管能做（when: isSuper）
 *   - 工具栏的「新建」按钮同样按 isSuper 出不给
 *
 * 「停用」和「移除」的区别：停用是软删除（status=rejected），市民登不进来
 * 但记录还在，工单历史、消息关联都不能断。⚠️ 所以这里没有真正的删除。
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
      // 建市民账号是超管专属；不是超管时 create 传 null，按钮就不出现
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
            // 已经 active 的不必再批
            when: (r) => r.status !== 'active',
            run: async (r) => {
              await patch('/api/admin/players?id=' + r.id + '&action=approve');
              await load();
            },
          },
          {
            key: 'reject',
            label: '停用',
            // 已经是 rejected 的不重复显示
            when: (r) => r.status !== 'rejected',
            run: async (r) => {
              // 停用后此人登不进来，但记录保留（工单、消息还指着这个人）
              if (!confirm('停用之后这位市民就登不进来了，真要停？')) return;
              await patch('/api/admin/players?id=' + r.id + '&action=reject');
              await load();
            },
          },
          {
            key: 'reset',
            label: '重置密码',
            when: isSuper,
            // 这里**不接 await load()**：重置完只弹个框，不重拉列表
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