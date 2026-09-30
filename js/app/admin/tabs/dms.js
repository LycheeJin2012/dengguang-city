/**
 * 私信巡查 tab（dms）。
 *
 * 看玩家之间的私信，必要时以管理员身份插一句。
 *
 * 注意这里全部走 /api/init?action=admin-* 而不是 /api/admin/*：
 * 私信是普通市民功能，巡查是管理端附带的入口，后端挂在 init 路由下。
 *
 * 回复方向有个容易搞错的分支：弹出框里「管理员回的」其实是
 * **以其中一方的身份发言**，to_player_id 决定发给谁。
 * 当发起人是灯灯客服时，管理员顶替灯灯回话，所以收件人取原本的收件人；
 * 否则是插话给发起人。
 *
 * 只读为主：这里不提供删除私信，也不提供「代读」。改不了的东西不给按钮。
 */

import { attachAiEditor } from '../../ai-editor.js';
import { adminContext } from '../state.js';
import {$,post,region,field,modal,date,text} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({}, () => loadActive());

  const load = () =>
    region(
      $('#records', view),
      () =>
        // 用 POST 而不是 GET：搜索词在 body 里，不是查询串
        post('/api/init?action=admin-dm-conversations', {
          q: $('[name=q]', view).value,
        }),
      (d, box) => {
        attachExport(d.conversations);
        table(
          box,
          [
            ['from_username', '谁发的'],
            ['to_username', '发给谁'],
            ['last_content', '最近一条'],
          ],
          d.conversations,
          [
            {
              key: 'open',
              label: '看看再回',
              run: async (r) => {
                const d = await post('/api/init?action=admin-dm-thread', {
                  from_player_id: r.from_player_id,
                  to_player_id: r.to_player_id,
                });
                const dialog = modal(
                  '私信巡查',
                  `<div class="wide">${d.messages
                    .map(
                      (m) =>
                        `<div class="row"><small>#${m.from_player_id} · ${date(
                          m.created_at
                        )}</small><p>${text(m.content)}</p></div>`
                    )
                    .join('')}</div>` + field('content', '管理员回的', 'textarea'),
                  {
                    wide: true,
                    submit: async (v) => {
                      // 顶替灯灯回话时收件人不变；否则回给发起人
                      await post('/api/init?action=admin-dm-reply', {
                        from_player_id: r.to_player_id,
                        to_player_id:
                          r.from_username === '灯灯客服' ? r.to_player_id : r.from_player_id,
                        content: v.content,
                      });
                      await load();
                    },
                  }
                );
                // AI 建议：只喂最近 8 条、总长截到 4000 字。
                // 整段历史塞进去既超 token 又容易被长文带偏
                attachAiEditor(dialog, {
                  targetName: 'content',
                  endpoint: '/api/init?action=admin-dm-ai-suggest',
                  context: d.messages
                    .slice(-8)
                    .map((m) => m.content)
                    .join('\n')
                    .slice(-4000),
                });
              },
            },
          ]
        );
      }
    );

  await bindList(load);
}