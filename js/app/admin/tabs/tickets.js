/**
 * Tickets tab.
 *
 * 工单管理 + 派单（dispatch 共享 tickets 视图，通过 adminContext.active === 'dispatch' 区分）。
 *
 * 复杂点：
 *   - 详情弹窗里要展开完整 history / 内部 triage / 反馈 / 附件 / 奖励
 *   - 自动办结 + 奖励发放
 *   - AI 自动派单
 *   - 公开处理设置（player 同意后才可见）
 *   - 附件上传（与工单事件挂钩）
 *
 * 这里把所有 dispatcher / attachment / AI 助手都用 callback 注入，
 * 避免直接依赖 switchTab / loadActive。
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
  if (adminContext.active === 'support') $('[name=category]', view).value = 'support';
  if (dispatching) {
    $('[name=status]', view).value = 'open';
    const policy = document.createElement('section');
    view.prepend(policy);
    region(policy, () => null, () => renderDispatchPolicy(policy));
  }

  const load = () =>
    region($('#records', view), async () => {
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
                      ['', '撤销派单'],
                      ...data.admins.map((a) => [a.id, a.username]),
                    ],
                  }
                ),
                {
                  label: '就这么派',
                  submit: async (values) => {
                    await patch('/api/tickets?id=' + encodeURIComponent(ticket.id), {
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
            when: (t) => canHandleTicket(t) && !t.assignee_id && !t.dispatch_hold,
            run: async (ticket) => {
              const result = await post(
                '/api/admin/auto-dispatch?id=' + encodeURIComponent(ticket.id),
                {}
              );
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
              let ticketUploads;
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
function ticketUploadsRef() {
  const ref = { value: null };
  return ref;
}

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
      ? `<p class="notice">${'承办奖励'}：${t.reward.amount} 💎 · ${t.reward.paid ? '已发放' : '等绑市民账号再发'} · ${'承办人'} #${t.reward.admin_id}</p>`
      : ''
  }${ticketTimeline(t.history)}</div>`;
}

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

function ticketPublicSettings(t) {
  return `<details class="wide"><summary>${'要不要公开'}</summary><p class="muted">${'得提交的人点了头才能公开。公开前先抹掉联系方式之类的个人信息——附件无论如何都不公开。'}</p>${field(
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

function wireDialogFeatures(dialog, t, r, ticketUploadsRef, refreshStatsFn) {
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
  const remaining = 5 - (t.attachments || []).length;
  if (canHandleTicket(t) && remaining > 0) {
    ticketUploadsRef.value = attachmentPicker(dialog, {
      max: remaining,
      existingBytes: (t.attachments || []).reduce((sum, file) => sum + file.size, 0),
    });
  }
  if (!canHandleTicket(t)) {
    $$('input,select,textarea', dialog).forEach((input) => (input.disabled = true));
    $('.modal-body', dialog).insertAdjacentHTML(
      'afterbegin',
      `<p class="notice">${'这张单子牵涉到你自己，换位超管来看吧。'}</p>`
    );
    return;
  }
  if (t.triage?.manual) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.textContent = '恢复自动分级';
    $('.modal-body > .actions', dialog).prepend(resume);
    resume.onclick = (e) =>
      action(e.currentTarget, async () => {
        const d = await post('/api/admin/ticket-triage', { ticket_id: t.id });
        if (d.triage?.manual)
          throw new Error('这期间别的管理员动过分级，你的人工设置没被覆盖，刷新看看');
        if (d.triage) {
          $('[name=priority]', dialog).value = d.triage.priority;
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
    history.onclick = () => import('../../audit-ui.js').then(({ viewAudit }) => viewAudit('tickets', t.id));
  }
}