/**
 * DMs tab.
 *
 * 私信监管：查看玩家间私信 / 管理员介入回复（带 AI 建议）。
 */

import { attachAiEditor } from '../../ai-editor.js';
import { adminContext } from '../state.js';
import { $, post, region, field, modal, date, tr, text } from '../../core.js';
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
            ['from_username', tr('发送方', 'From')],
            ['to_username', tr('接收方', 'To')],
            ['last_content', tr('最近消息', 'Last message')],
          ],
          d.conversations,
          [
            {
              key: 'open',
              label: tr('查看与回复', 'View & reply'),
              run: async (r) => {
                const d = await post('/api/init?action=admin-dm-thread', {
                  from_player_id: r.from_player_id,
                  to_player_id: r.to_player_id,
                });
                const dialog = modal(
                  tr('私信监管', 'DM moderation'),
                  `<div class="wide">${d.messages
                    .map(
                      (m) =>
                        `<div class="row"><small>#${m.from_player_id} · ${date(
                          m.created_at
                        )}</small><p>${text(m.content)}</p></div>`
                    )
                    .join('')}</div>` + field('content', tr('管理员回复', 'Admin reply'), 'textarea'),
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