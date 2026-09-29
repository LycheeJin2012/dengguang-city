/**
 * Times tab.
 *
 * 成绩审核：批准/撤销个人赛道成绩。
 */

import { adminContext } from '../state.js';
import {$,api,patch,region,date} from '../../core.js'
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
        ['player_username', '市民'],
        ['track_name', '赛道'],
        ['time_ms', '毫秒'],
        ['verified', '已认证', (v) => (v ? '✓' : '—')],
      ],
      d.times,
      [
        {
          key: 'verify',
          label: '改认证方式',
          run: async (r) => {
            await patch(`/api/race-times?id=${r.id}&action=${r.verified ? 'unverify' : 'verify'}`);
            await renderSelf(loadActive);
          },
        },
      ]
    );
  });
}