/**
 * Owners tab.
 *
 * 酒店老板账户管理。仅 super 可创建/编辑。
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import {
  $,
  api,
  post,
  patch,
  modal,
  region,
  field,
  tr,
  status,
} from '../../core.js';
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
          ['username', tr('经营账号', 'Owner account')],
          ['player_username', tr('绑定玩家', 'Linked citizen')],
          ['hotel_count', tr('酒店数量', 'Hotels')],
          ['status', tr('状态', 'Status'), status],
        ],
        d.owners,
        [
          { key: 'edit', label: tr('编辑 / 停用', 'Edit / disable'), run: edit },
          {
            key: 'audit',
            label: tr('操作记录', 'History'),
            run: (r) => viewAudit('hotel_owners', r.id),
          },
        ]
      );
    });

  async function edit(owner = {}) {
    const d = await api('/api/admin/players');
    modal(
      tr(
        owner.id ? '编辑酒店老板账户' : '创建酒店老板账户',
        owner.id ? 'Edit hotel owner' : 'Create hotel owner'
      ),
      field('username', tr('经营账号', 'Username'), 'text', owner.username || '') +
        field(
          owner.id ? 'new_password' : 'password',
          tr(
            owner.id ? '新密码（留空不改）' : '初始密码',
            owner.id ? 'New password (optional)' : 'Initial password'
          ),
          'password',
          '',
          { required: !owner.id }
        ) +
        field(
          'linked_player_id',
          tr('关联玩家（可选）', 'Linked citizen (optional)'),
          'select',
          owner.linked_player_id || '',
          {
            required: false,
            options: [
              ['', tr('不关联', 'None')],
              ...d.players
                .filter((p) => p.status === 'active')
                .map((p) => [p.id, `#${p.id} · ${p.username}`]),
            ],
          }
        ) +
        field('status', tr('状态', 'Status'), 'select', owner.status || 'active', {
          options: [
            ['active', tr('启用', 'Active')],
            ['disabled', tr('停用', 'Disabled')],
          ],
        }) +
        `<p class="muted wide">${tr(
          '创建后，在酒店管理中将酒店分配给此经营账户。关联玩家后，该玩家首页会显示"我的酒店"。',
          'After creation, assign hotels from Hotel management. Linked citizens will see My hotel.'
        )}</p>`,
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