/**
 * Home signup dialog (kart / circuit / license).
 *
 * v79 拆分自原 home.js 的 signup() 函数。逻辑 1:1 迁移，依赖不变。
 */

import {
  api,
  post,
  field,
  modal,
  requirePlayer,
  toast,
  tr,
} from '../../core.js';

export async function signup(kind, bundle) {
  const p = await requirePlayer();
  const circuit = kind === 'circuit';
  const license = kind === 'license';
  let fields = '';
  if (circuit) {
    const tracks = bundle.tracks.filter((t) => t.is_active);
    if (!tracks.length) throw new Error(tr('目前暂无开放赛道', 'No open tracks'));
    fields +=
      field('track_id', tr('赛道', 'Track'), 'select', tracks[0].id, {
        options: tracks.map((t) => [t.id, `${t.name} · 💎${t.trial_price}`]),
      }) +
      field('license', tr('驾照等级', 'License grade'), 'select', 'B', {
        options: ['B', 'A', 'S'],
      });
  }
  if (license)
    fields +=
      field('exam_type', tr('考试类型', 'Exam'), 'select', 'written', {
        options: [
          ['written', tr('笔试', 'Written')],
          ['road', tr('路考', 'Road')],
          ['upgrade', tr('升级', 'Upgrade')],
        ],
      }) +
      field('exam_date', tr('期望日期', 'Preferred date'), 'date', '', {
        required: false,
      });
  else fields += field('car', tr('车型', 'Vehicle'), 'text', '', { required: false });

  modal(
    tr(
      license ? '驾照报名' : circuit ? '国际试车报名' : '卡丁车报名',
      license ? 'License application' : circuit ? 'Circuit signup' : 'Kart signup'
    ),
    fields +
      field('session', tr('期望场次', 'Preferred session'), 'text', '', {
        required: false,
      }) +
      field('name', tr('游戏 ID', 'Game ID'), 'text', p.username) +
      field('contact', tr('联系方式', 'Contact'), 'text', p.email) +
      field('note', tr('备注', 'Notes'), 'textarea', '', { required: false }),
    {
      label: tr('提交报名', 'Apply'),
      submit: async (d) => {
        await post('/api/' + kind, { ...d, exam_session: d.session });
        toast(tr('报名已提交', 'Application submitted'));
      },
    }
  );
}