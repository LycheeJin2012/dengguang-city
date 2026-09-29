/**
 * DMs tab.
 *
 * 私信监管：查看玩家间私信 / 管理员介入回复（带 AI 建议）。
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