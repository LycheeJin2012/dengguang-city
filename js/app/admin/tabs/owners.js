/**
 * 酒店经营账号 tab（owners）。
 *
 * 客栈老板的账号管理。整页只有超管能进（入口在 admin-navigation.js 的
 * superOnly 白名单里）。
 *
 * 不能改的行为：
 *   - 编辑时密码框留空 = 不改密码。提交前 delete 空字段，否则旧密码被清掉
 *   - 关联市民是可选项。关联之后那位市民首页会多出「我的客栈」入口，
 *     所以下拉里只列 active 的市民
 *   - status 存 disabled 而不是物理删除：老板名下可能还挂着客栈
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

  /** 新建 / 编辑经营账号。owner 有 id 就是编辑。 */
  async function edit(owner = {}) {
    // 市民列表只是给「关联市民」那个下拉用的，所以每次打开都拉一次
    const d = await api('/api/admin/players');
    modal(
      owner.id ? '改经营账号' : '开个客栈经营账号',
      field('username', '经营账号', 'text', owner.username || '') +
        // 编辑用 new_password（可空），新建用 password（必填）
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
              // 已停用的市民不出现在下拉里
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
          // 留空 = 不改密码
          if (!values.new_password) delete values.new_password;
          await (owner.id
            ? patch('/api/admin/hotel-owners?id=' + owner.id, values)
            : post('/api/admin/hotel-owners', values));
          await load();
        },
      }
    );
  }

  // 收尾直接 load（不是 bindList）：这页的 load 不读工具栏条件，
  // 绑防抖也不会让它重新拉。import 里的 bindList 属于遗留未用项，本次没动。
  await load();
}