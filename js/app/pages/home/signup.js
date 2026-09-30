/**
 * Home signup dialog (kart / circuit / license).
 *
 * v79 拆分自原 home.js 的 signup() 函数。逻辑 1:1 迁移，依赖不变。
 */

import {api,post,field,modal,requirePlayer,toast} from '../../core.js'

export async function signup(kind, bundle) {
  const p = await requirePlayer();
  const circuit = kind === 'circuit';
  const license = kind === 'license';
  let fields = '';
  if (circuit) {
    const tracks = bundle.tracks.filter((t) => t.is_active);
    if (!tracks.length) throw new Error('暂时没有开放的赛道');
    fields +=
      field('track_id', '哪条赛道', 'select', tracks[0].id, {
        options: tracks.map((t) => [t.id, `${t.name} · 💎${t.trial_price}`]),
      }) +
      field('license', '驾照等级', 'select', 'B', {
        options: ['B','A'],
      });
  }
  if (license)
    fields +=
      field('exam_type', '考什么', 'select', 'written', {
        options: [
          ['written', '笔试'],
          ['road', '路考'],
          ['upgrade', '升级'],
        ],
      }) +
      field('exam_date', '希望哪天', 'date', '', {
        required: false,
      });
  // 注意这里是 else 不是独立的 if：考驾照不填「开什么车」，
  // 另两种才要。改成两个 if 会让驾照报名多出一个用不上的车名字段。
  else fields += field('car', '开什么车', 'text', '', { required: false });

  modal(
    license ? '驾照报名' : circuit ? '国际试车报名' : '卡丁车报名',
    fields +
      field('session', '希望哪一场', 'text', '', {
        required: false,
      }) +
      field('name', '游戏 ID', 'text', p.username) +
      field('contact', '怎么联系你', 'text', p.email) +
      field('note', '还想说的', 'textarea', '', { required: false }),
    {
      label: '递交报名',
      submit: async (d) => {
        await post('/api/' + kind, { ...d, exam_session: d.session });
        toast('递上去了，等排期');
      },
    }
  );
}