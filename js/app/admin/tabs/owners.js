/**
 * Owners tab.
 *
 * 酒店老板账户管理。仅 super 可创建/编辑。
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import {$,api,post,patch,modal,region,field,status} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  const load = () =>
    region($('#records', view), () => api('/api/admin/hotel-owners'), (d, box) => {
      attachExport(d.owners);
      table(
        box,
        [
          ['id', 'ID'],
          ['username', '经营账号'],
          ['player_username', '绑市民'],
          ['hotel_count', '客栈数量'],
          ['status', '状态', status],
        ],
        d.owners,
        [
          { key: 'edit', label: '改 / 停用', run: edit },
          {
            key: 'audit',
            label: '经手记录',
            run: (r) => viewAudit('hotel_owners', r.id),
          },
        ]
      );
    });

  async function edit(owner = {}) {
    const d = await api('/api/admin/players');
    modal(
      owner.id ? '改经营账号' : '开个客栈经营账号',
      field('username', '经营账号', 'text', owner.username || '') +
        field(
          owner.id ? 'new_password' : 'password',
          owner.id ? '新密码（留空不动旧的）' : '起步密码',
          'password',
          '',
          { required: !owner.id }
        ) +
        field(
          'linked_player_id',
          '关联市民（可不填）',
          'select',
          owner.linked_player_id || '',
          {
            required: false,
            options: [
              ['', '先不关联'],
              ...d.players
                .filter((p) => p.status === 'active')
                .map((p) => [p.id, `#${p.id} · ${p.username}`]),
            ],
          }
        ) +
        field('status', '状态', 'select', owner.status || 'active', {
          options: [
            ['active', '启用'],
            ['disabled', '停用'],
          ],
        }) +
        `<p class="muted wide">${'建好之后去「酒店」页把客栈分给他。要是关联了市民，那位市民首页就会多出「我的客栈」入口。'}</p>`,
      {
        submit: async (values) => {
          if (!values.new_password) delete values.new_password;
          await (owner.id
            ? patch('/api/admin/hotel-owners?id=' + owner.id, values)
            : post('/api/admin/hotel-owners', values));
          await load();
        },
      }
    );
  }

  await load();
}