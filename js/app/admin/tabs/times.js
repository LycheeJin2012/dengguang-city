/**
 * 成绩审核 tab（times）。
 *
 * 批准 / 撤销个人赛道成绩。个人赛的成绩要人工确认才进排行榜。
 *
 * 两个值得留意的点：
 *   - 这页没有搜索框（toolbar({ search: false })），所以没有 bindList。
 *     列表小，全量展示
 *   - 改完认证不直接 reload()，而是 renderSelf(loadActive) 重新跑一遍自己。
 *     绕一圈是为了让 tab 重新初始化、状态干净；代价是多拉一次接口。
 *     ⚠️ import 的是本文件自己（./times.js 的 render），
 *     也就是递归调用自己而不是调 loadActive。这是原代码的写法，本次保持原样。
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
          // 同一个接口 + 相反的 action：已认证就撤销，未认证就批准
          run: async (r) => {
            await patch(`/api/race-times?id=${r.id}&action=${r.verified ? 'unverify' : 'verify'}`);
            await renderSelf(loadActive);
          },
        },
      ]
    );
  });
}
