/**
 * 工单中心 tab（tickets + dispatch 共用）。
 *
 * dispatch 不是独立页面，它复用这个 render，靠 adminContext.active === 'dispatch'
 * 切出派单视角：预设「还没派 + 未结」筛选，并在工具栏上方插一块派单规矩面板。
 *
 * 详情弹窗是整个后台最复杂的一块，拆成了下面几个纯函数：
 *   ticketBodyHtml       单子正文 + 授权状态 + 历史 + 附件 + 奖励
 *   triageBlock          内部评估（AI / 人工 / 规则三来源）
 *   feedbackBlock        玩家对已发回复的反馈
 *   ticketReplyForm      状态 / 优先级 / 承办人 / 回复内容
 *   ticketPublicSettings 公开处理设置（玩家同意才可见）
 *   wireDialogFeatures   往弹窗里塞按钮、附件、权限禁用
 *
 * 四个不能改掉的行为，都是踩过坑的：
 *   1. canHandleTicket 为 false（这张单牵涉到自己）时，整张表单禁用并提前 return。
 *      少这一步就等于给了「看得到改不了」的假按钮
 *   2. 附件提交走 ticketUploadsRef 间接层：modal 的 submit 闭包建得比
 *      attachmentPicker 早，picker 得等弹窗出来后才拿得到，所以用一个 ref 兜着
 *   3. 恢复自动分级时先看服务端返回的 triage.manual —— 别人在这期间手改过分级，
 *      就不能拿自动结果盖掉人工判断，抛错让管理员刷新
 *   4. 弹窗里「办结」按钮只是把状态下拉改成 resolved 再 requestSubmit()，
 *      走的是同一条提交路径 —— 这样奖励发放、留痕都还在后端那一条链上
 *
 * dispatcher / attachment / AI 助手都靠回调和 shared.js 注入，
 * 不直接 import 路由层，避免和 index.js 循环依赖。
 */

import { adminContext } from '../state.js';
import { ticketTimeline, replyAuthor } from '../../ticket-form.js';
import { attachTicketInsights } from '../../ticket-insights.js';
import { attachAiEditor } from '../../ai-editor.js';
import { renderDispatchPolicy } from '../../dispatch-policy.js';
import { attachmentPicker, renderAttachments } from '../../attachments.js';
import {$,$$,api,post,patch,esc,text,ticketBody,date,status,modal,region,action,toast,field,state} from '../../core.js'
import {
  table,
  toolbar,
  bindList,
  params,
  attachExport,
  refreshStats,
  canHandleTicket,
  isSuper,
} from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  const dispatching = adminContext.active === 'dispatch';
  // 管理员 id → 用户名。列表要显示承办人，但 /api/tickets 不带名字，
  // 所以并行拉一次管理员表建映射
  const adminNames = new Map();

  toolbar(
    {
      options: ['open', 'in_progress', 'resolved', 'closed'],
      extra:
        field(
          'assignment',
          '派单状态',
          'select',
          dispatching ? 'unassigned' : '',
          {
            required: false,
            options: [
              ['', '全部'],
              ['unassigned', '还没派'],
              ['mine', '派给我'],
            ],
          }
        ) +
        field('category', '分类', 'select', '', {
          required: false,
          options: [
            ['', '所有分类'],
            ['message', '留言'],
            ['support', '人工客服'],
            ['hotel', '客栈'],
            ['license', '驾照'],
            ['race', '赛车'],
            ['kart', '卡丁车'],
            ['service', '服务'],
          ],
        }),
    },
    () => loadActive()
  );
  // 从「人工客服」侧栏跳过来时，直接把分类锁定在 support
  if (adminContext.active === 'support') $('[name=category]', view).value = 'support';

  if (dispatching) {
    // 派单视角：只看待办，且在工具栏上面插一块派单规矩面板
    $('[name=status]', view).value = 'open';
    const policy = document.createElement('section');
    view.prepend(policy);
    // region(() => null) 借用它的 loading / 重试 / 竞态防护外壳，
    // 但数据源是本地 render，不用发请求
    region(policy, () => null, () => renderDispatchPolicy(policy));
  }

  const load = () =>
    region($('#records', view), async () => {
      // 工单和管理员表并行拉：承办人名字要靠后者
      const [tickets, admins] = await Promise.all([
        api('/api/tickets?' + params()),
        api('/api/admin/admins'),
      ]);
      admins.admins.forEach((a) => adminNames.set(a.id, a.username));
      return tickets;
    }, (d, box) => {
      attachExport(d.tickets);
      table(
        box,
        [
          ['id', 'ID'],
          ['title', '标题'],
          ['player_username', '市民'],
          [
            'category',
            '分类',
            (category) =>
              esc(
                (
                  {
                    support: '人工客服',
                    message: '留言',
                    hotel: '客栈',
                    license: '驾照',
                    race: '赛车',
                    kart: '卡丁车',
                    service: '服务',
                    comment: '评论',
                  }
                )[category] || category
              ),
          ],
          ['status', '状态', status],
          [
            'priority',
            '内部优先级',
            (v) => esc(({ low: '低', normal: '普通', high: '高', urgent: '紧急' })[v] || v),
          ],
          [
            'triage_urgency',
            '急不急',
            (v) =>
              esc(
                ({ routine: '常规', time_sensitive: '得赶紧办', emergency: '紧急' })[v] ||
                  '—'
              ),
          ],
          [
            'attachment_count',
            '附件',
            (n) => (n ? '📎 ' + Number(n) : '—'),
          ],
          [
            'assignee_id',
            '承办人',
            (id) => esc(id ? adminNames.get(id) || '#' + id : '还没派'),
          ],
        ],
        d.tickets,
        [
          {
            key: 'assign',
            label: '派单',
            // 牵涉到自己的单子连派单按钮都不给
            when: canHandleTicket,
            run: async (ticket) => {
              const data = await api('/api/admin/admins');
              modal(
                '派单 → ' + ticket.title,
                field(
                  'assignee_id',
                  '承办人',
                  'select',
                  ticket.assignee_id || '',
                  {
                    required: false,
                    options: [
                      // 空值 = 撤销派单
                      ['', '撤销派单'],
                      ...data.admins.map((a) => [a.id, a.username]),
                    ],
                  }
                ),
                {
                  label: '就这么派',
                  submit: async (values) => {
                    await patch('/api/tickets?id=' + encodeURIComponent(ticket.id), {
                      // 空串转 null 才是「撤销」，空串后端不认
                      assignee_id: values.assignee_id ? Number(values.assignee_id) : null,
                    });
                    toast('派单记下了');
                    await load();
                  },
                }
              );
            },
          },
          {
            key: 'ai',
            label: '自动补派',
            // 只在「还没人接 + 没收住」时出现。已派的或被 hold 的不重复触发
            when: (t) => canHandleTicket(t) && !t.assignee_id && !t.dispatch_hold,
            run: async (ticket) => {
              const result = await post(
                '/api/admin/auto-dispatch?id=' + encodeURIComponent(ticket.id),
                {}
              );
              // 后端可能派成功也可能给个理由（样本不足、超忙…），两种都直接说
              toast(
                result.status === 'assigned'
                  ? '已经自动派给 ' + result.admin.username
                  : result.reason
              );
              await load();
            },
          },
          {
            key: 'detail',
            label: '办这张单子',
            run: async (r) => {
              const data = await api('/api/tickets?id=' + r.id);
              const t = data.ticket;
              const admins = await api('/api/admin/admins');
              // ⚠️ 这里传的是 ticketUploadsRef 这个**函数本身**，不是它调用后的
              // 返回值。所以下面 wireDialogFeatures 里的 `ticketUploadsRef.value = …`
              // 挂在了函数对象上。弹窗是一次只开一个的，实际不会串，所以保持原样
              // （改成 ticketUploadsRef() 会让 .value 变成每次调用独立的壳 ——
              // 行为上更干净，但那是修 bug，不在本次可读性重构范围内）。
              const dialog = modal(
                '单子 #' + r.id,
                ticketBodyHtml(t) +
                  ticketReplyForm(t, admins) +
                  ticketPublicSettings(t),
                ticketSubmitConfig(r, t, load, ticketUploadsRef)
              );
              wireDialogFeatures(dialog, t, r, ticketUploadsRef, () =>
                refreshStats(loadActive)
              );
              return dialog;
            },
          },
        ]
      );
    });

  await bindList(load);
}

// ----- helpers --------------------------------------------------------------

// ticketUploadsRef 用一个 wrapper 持有对象引用，dialog submit 内能读取。
// 见 render() 里那处 ⚠️ 注释：目前调用方传的是函数本身而非返回值。
function ticketUploadsRef() {
  const ref = { value: null };
  return ref;
}

/** 弹窗正文：授权状态、被投诉对象、正文、已有回复、评估、反馈、附件、奖励、历史 */
function ticketBodyHtml(t) {
  return `<div class="wide notice"><b>${esc(t.title)}</b><p>${'公开授权'}：${t.public_consent ? '已同意' : '未同意'}</p>${
    t.target_admin_id
      ? `<p>${'被投诉的管理员'} #${t.target_admin_id}</p>`
      : ''
  }${
    t.target_player_name
      ? `<p>${'被举报的市民'}：${esc(t.target_player_name)} ${
          t.target_player_id ? '#' + t.target_player_id : '（自己填）'
        }</p>`
      : ''
  }<div>${ticketBody(t.body)}</div>${
    t.replied_by ? `<p><b>${esc(replyAuthor(t))}</b> · ${date(t.replied_at)}</p>` : ''
  }${
    t.auto_reply
      ? `<div class="notice"><b>${'灯灯 · 自动基础回复'}</b><p>${text(t.auto_reply)}</p></div>`
      : ''
  }${
    t.triage
      ? triageBlock(t.triage)
      : ''
  }${
    t.feedback?.length
      ? feedbackBlock(t)
      : ''
  }${renderAttachments(t.attachments)}${
    t.reward
      ? `<p class="notice">${'承办奖励'}：${t.reward.amount} 💎 · ${
          t.reward.paid ? '已发放' : '等绑市民账号再发'
        } · ${'承办人'} #${t.reward.admin_id}</p>`
      : ''
  }${ticketTimeline(t.history)}</div>`;
}

/** 内部评估块。id="internal-triage" 是「恢复自动分级」按钮回填内容时要抓的锚点。 */
function triageBlock(trg) {
  return `<aside class="notice" id="internal-triage"><b>内部评估（仅管理端）</b><p>优先级：${esc(
    ({ low: '低', normal: '普通', high: '高', urgent: '紧急' })[trg.priority]
  )} · 紧急程度：${esc(
    ({ routine: '常规', time_sensitive: '得赶紧办', emergency: '紧急' })[trg.urgency]
  )} · 复杂度：${trg.complexity === 'complex' ? '复杂' : '一般'}</p><p>${text(
    trg.reason
  )}</p><small>${
    trg.source === 'ai' ? 'AI 判的' : trg.source === 'manual' ? '人工调过' : '规则判的'
  } · ${date(trg.updated_at)}</small></aside>`;
}

/** 已发回复上的玩家反馈。回复人名字从 history 里按 target_id 反查。 */
function feedbackBlock(t) {
  return `<aside class="notice"><b>回复反馈（内部监督）</b>${t.feedback
    .map(
      (f) =>
        `<p><b>${f.helpful ? '有用' : '还没解决'}</b> · 回复记录 #${esc(f.target_id)} · ${date(
          f.updated_at
        )}<br>${esc(
          t.history?.find((e) => e.id === Number(f.target_id))?.actor_name || '客服回的'
        )} · ${esc(f.reason)} · ${text(f.comment)}</p>`
    )
    .join('')}</aside>`;
}

/** 受理表单：状态 / 优先级 / 派给谁 / 回什么 */
function ticketReplyForm(t, admins) {
  return (
    field('status', '状态', 'select', t.status, {
      options: ['open', 'in_progress', 'resolved', 'closed'],
    }) +
    field('priority', '优先级', 'select', t.priority || 'normal', {
      options: ['low', 'normal', 'high', 'urgent'],
    }) +
    field('assignee_id', '派给谁', 'select', t.assignee_id || '', {
      required: false,
      options: [
        ['', '没人接'],
        ...admins.admins.map((a) => [a.id, a.username]),
      ],
    }) +
    field('admin_reply', '回什么', 'textarea', t.admin_reply || '', {
      required: false,
    })
  );
}

/** 公开处理设置。玩家没勾同意时，整块在 wireDialogFeatures 里被禁用。 */
function ticketPublicSettings(t) {
  // 锁定的中文文案。提出具名常量只是为了让下面的模板串短一点 —— 文字逐字未改
  const CONSENT_HINT =
    '得提交的人点了头才能公开。公开前先抹掉联系方式之类的个人信息——附件无论如何都不公开。';
  return `<details class="wide"><summary>${'要不要公开'}</summary><p class="muted">${CONSENT_HINT}</p>${field(
    'public_visible',
    '放到公开列表里',
    'checkbox',
    t.public_visible
  )}${field(
    'public_title',
    '公开标题',
    'text',
    t.public_title || t.title,
    { required: false, maxlength: 120 }
  )}${field(
    'public_body',
    '对外说明',
    'textarea',
    t.public_body || t.body,
    { required: false }
  )}${field(
    'public_reply',
    '对外答复',
    'textarea',
    t.public_reply || t.admin_reply || '',
    { required: false }
  )}</details>`;
}

/**
 * 弹窗的提交配置。
 *
 * submit 传 null 的效果是：弹窗只剩取消按钮，办不了就别给提交入口。
 * 三种结局分别 toast 一次 —— 奖励已发 / 奖励挂起等承办人绑账号 / 单纯存好了。
 */
function ticketSubmitConfig(r, t, load, ticketUploadsRef) {
  const submit = canHandleTicket(t)
    ? async (values) => {
        const saved = await patch('/api/tickets?id=' + r.id, {
          ...values,
          attachment_ids: ticketUploadsRef.value ? ticketUploadsRef.value.ids() : [],
          assignee_id: values.assignee_id ? Number(values.assignee_id) : null,
        });
        ticketUploadsRef.value?.commit?.();
        await load();
        if (saved.reward?.amount)
          toast(
            '办结了，10 绿宝石已经打给 ' +
              saved.reward.player_name
          );
        else if (saved.reward?.pending)
          toast(
            '办结了。奖励等承办人绑上市民账号就发'
          );
        else toast('存好了');
      }
    : null;
  return { wide: true, submit };
}

/**
 * 弹窗装配：公开开关禁用 → 办结按钮 → 附件 → 权限拦截 → 恢复分级 → AI 草稿 → 留痕
 *
 * 顺序有讲究：权限拦截（canHandleTicket 为 false）必须夹在附件之后单独 return，
 * 后面那些按钮也一个都不挂。
 */
function wireDialogFeatures(dialog, t, r, ticketUploadsRef, refreshStatsFn) {
  // 玩家没同意公开，公开相关字段一律锁死
  $('[name=public_visible]', dialog).disabled = !t.public_consent;
  if (
    canHandleTicket(t) &&
    t.assignee_id &&
    t.status !== 'resolved' &&
    (isSuper() || t.assignee_id === state.session.user.id)
  ) {
    const finish = document.createElement('button');
    finish.type = 'button';
    finish.className = 'primary';
    finish.textContent = '办结这张单 · 10 💎';
    $('.modal-body > .actions', dialog).prepend(finish);
    finish.onclick = () => {
      $('[name=status]', dialog).value = 'resolved';
      $('form', dialog).requestSubmit();
    };
  }
  // 上限 5 个附件，扣掉已有的。existingBytes 用来让前端先算总大小上限
  const remaining = 5 - (t.attachments || []).length;
  if (canHandleTicket(t) && remaining > 0) {
    ticketUploadsRef.value = attachmentPicker(dialog, {
      max: remaining,
      existingBytes: (t.attachments || []).reduce((sum, file) => sum + file.size, 0),
    });
  }

  if (!canHandleTicket(t)) {
    // 牵涉到自己：全字段禁用 + 说明，然后到此为止，后面那些按钮都不挂
    $$('input,select,textarea', dialog).forEach((input) => (input.disabled = true));
    $('.modal-body', dialog).insertAdjacentHTML(
      'afterbegin',
      `<p class="notice">${'这张单子牵涉到你自己，换位超管来看吧。'}</p>`
    );
    return;
  }

  // 分级被人工改过 → 给一个「改回自动」的后悔药
  if (t.triage?.manual) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.textContent = '恢复自动分级';
    $('.modal-body > .actions', dialog).prepend(resume);
    resume.onclick = (e) =>
      action(e.currentTarget, async () => {
        const d = await post('/api/admin/ticket-triage', { ticket_id: t.id });
        // 还是 manual = 这期间别的管理员动过分级。别拿自动结果盖掉人工判断
        if (d.triage?.manual)
          throw new Error('这期间别的管理员动过分级，你的人工设置没被覆盖，刷新看看');
        if (d.triage) {
          $('[name=priority]', dialog).value = d.triage.priority;
          // 就地重画评估块。管理员已经写好的回复草稿不动 —— 这个按钮只管分级
          $('#internal-triage', dialog).innerHTML =
            '<b>内部评估（管理端可见）</b><p>' +
            esc(d.triage.priority + ' / ' + d.triage.urgency + ' / ' + d.triage.complexity) +
            '</p><p>' +
            text(d.triage.reason) +
            '</p><small>' +
            esc(d.triage.source === 'ai' ? 'AI 判的' : '规则判的') +
            '</small>';
          resume.remove();
        }
        toast('已恢复自动分级，回复草稿还在');
      });
  }
  attachAiEditor(dialog, { ticketId: t.id, targetName: 'admin_reply' });
  attachTicketInsights(dialog, t.id);
  if (isSuper()) {
    const history = document.createElement('button');
    history.type = 'button';
    history.textContent = '看完整留痕';
    $('.modal-body > .actions', dialog).prepend(history);
    // 动态 import：audit-ui 只在这个按钮被点时才需要，
    // 没必要让它进后台首屏的依赖图
    history.onclick = () => import('../../audit-ui.js').then(({ viewAudit }) => viewAudit('tickets', t.id));
  }
}