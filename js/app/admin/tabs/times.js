/**
 * Times tab.
 *
 * 成绩审核：批准/撤销个人赛道成绩。
 */

import { adminContext } from '../state.js';
import { $, api, patch, region, tr, date } from '../../core.js';
import { table, toolbar, bindList, attachExport } from '../shared.js';
import { render as renderSelf } from './times.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ search: false }, () => loadActive());
  await region($('#records', view), () => api('/api/admin/race-times'), (d, box) => {
    attachExport(d.times);
    table(
      box,
      [
        ['player_username', tr('市民', 'Citizen')],
        ['track_name', tr('赛道', 'Track')],
        ['time_ms', tr('毫秒', 'Milliseconds')],
        ['verified', tr('已认证', 'Verified'), (v) => (v ? '✓' : '—')],
      ],
      d.times,
      [
        {
          key: 'verify',
          label: tr('切换认证', 'Toggle verification'),
          run: async (r) => {
            await patch(`/api/race-times?id=${r.id}&action=${r.verified ? 'unverify' : 'verify'}`);
            await renderSelf(loadActive);
          },
        },
      ]
    );
  });
}