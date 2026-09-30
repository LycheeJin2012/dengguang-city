/**
 * 管理员账号 tab（admins）。
 *
 * 增删管理员 / 改密码 / 绑解绑市民账号。整个页面只有超管能进来
 * （入口在 admin-navigation.js 的 superOnly 白名单里）。
 *
 * 三个不能改的行为：
 *   - 改密码时留空 = 不动旧密码。所以提交前要 delete 掉空字段，
 *     否则后端会把密码改成空
 *   - 「移除」对自己的行不显示（when 判断）。不然能把自己删掉锁死后台
 *   - 解绑走的是 /api/init 的 merge/unmerge 系列，不是 /api/admin/admins。
 *     绑定的市民账号是跨表关系，得走专门的口子
 */

import { viewAudit } from '../../audit-ui.js';
import { adminContext } from '../state.js';
import {$,api,post,patch,del,modal,region,field,state} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  /** 新建 / 编辑管理员。r 有 id 就是编辑。 */
  function edit(r = {}) {
    modal(
      r.id ? '改管理员' : '新添管理员',
      field('username', '账号', 'text', r.username || '') +
        // 编辑时用 new_password 且非必填；新建时用 password 且必填
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
        // 专长只给自动派单做参考，不参与权限判断
        field(
          'specialties',
          '分管什么、擅长什么',
          'text',
          r.specialties || '',
          { required: false, maxlength: 300 }
        ),
      {
        submit: async (d) => {
          // 留空不改密码：空值不发给后端
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
                    // 同一个接口，按有没有 player_id 走绑 / 解绑两条分支。
                    // 解绑时仍要带上原来的 player_id —— 后端靠它定位要拆哪条关系
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
            // 不能删自己 —— 会把后台最后一个入口关掉
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