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
import {
  $,
  $$,
  api,
  post,
  patch,
  esc,
  text,
  ticketBody,
  date,
  tr,
  status,
  modal,
  region,
  action,
  toast,
  field,
  state,
} from '../../core.js';
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
          tr('派单状态', 'Assignment'),
          'select',
          dispatching ? 'unassigned' : '',
          {
            required: false,
            options: [
              ['', tr('全部', 'All')],
              ['unassigned', tr('未派单', 'Unassigned')],
              ['mine', tr('派给我', 'Assigned to me')],
            ],
          }
        ) +
        field('category', tr('分类', 'Category'), 'select', '', {
          required: false,
          options: [
            ['', tr('全部分类', 'All categories')],
            ['message', '留言'],
            ['support', '人工客服'],
            ['hotel', '酒店'],
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
          ['title', tr('标题', 'Title')],
          ['player_username', tr('市民', 'Citizen')],
          [
            'category',
            tr('分类', 'Category'),
            (category) =>
              esc(
                (
                  {
                    support: tr('人工客服', 'Human support'),
                    message: tr('留言', 'Message'),
                    hotel: tr('酒店', 'Hotel'),
                    license: tr('驾照', 'License'),
                    race: tr('赛车', 'Race'),
                    kart: tr('卡丁车', 'Kart'),
                    service: tr('服务', 'Service'),
                    comment: tr('评论', 'Comment'),
                  }
                )[category] || category
              ),
          ],
          ['status', tr('状态', 'Status'), status],
          [
            'priority',
            tr('内部优先级', 'Internal priority'),
            (v) => esc(({ low: '低', normal: '普通', high: '高', urgent: '紧急' })[v] || v),
          ],
          [
            'triage_urgency',
            tr('紧急程度', 'Urgency'),
            (v) =>
              esc(
                ({ routine: '常规', time_sensitive: '需尽快处理', emergency: '紧急风险' })[v] ||
                  '—'
              ),
          ],
          [
            'attachment_count',
            tr('附件', 'Attachments'),
            (n) => (n ? '📎 ' + Number(n) : '—'),
          ],
          [
            'assignee_id',
            tr('承办人', 'Assignee'),
            (id) => esc(id ? adminNames.get(id) || '#' + id : tr('未派单', 'Unassigned')),
          ],
        ],
        d.tickets,
        [
          {
            key: 'assign',
            label: tr('派单', 'Assign'),
            when: canHandleTicket,
            run: async (ticket) => {
              const data = await api('/api/admin/admins');
              modal(
                tr('派单 · ', 'Assign · ') + ticket.title,
                field(
                  'assignee_id',
                  tr('承办管理员', 'Assign to'),
                  'select',
                  ticket.assignee_id || '',
                  {
                    required: false,
                    options: [
                      ['', tr('取消派单', 'Unassign')],
                      ...data.admins.map((a) => [a.id, a.username]),
                    ],
                  }
                ),
                {
                  label: tr('确认派单', 'Confirm assignment'),
                  submit: async (values) => {
                    await patch('/api/tickets?id=' + encodeURIComponent(ticket.id), {
                      assignee_id: values.assignee_id ? Number(values.assignee_id) : null,
                    });
                    toast(tr('派单已保存', 'Assignment saved'));
                    await load();
                  },
                }
              );
            },
          },
          {
            key: 'ai',
            label: tr('自动补派', 'Auto assign'),
            when: (t) => canHandleTicket(t) && !t.assignee_id && !t.dispatch_hold,
            run: async (ticket) => {
              const result = await post(
                '/api/admin/auto-dispatch?id=' + encodeURIComponent(ticket.id),
                {}
              );
              toast(
                result.status === 'assigned'
                  ? tr('已自动派给 ', 'Assigned to ') + result.admin.username
                  : result.reason
              );
              await load();
            },
          },
          {
            key: 'detail',
            label: tr('处理工单', 'Review ticket'),
            run: async (r) => {
              const data = await api('/api/tickets?id=' + r.id);
              const t = data.ticket;
              const admins = await api('/api/admin/admins');
              let ticketUploads;
              const dialog = modal(
                tr('工单 #', 'Ticket #') + r.id,
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
  return `<div class="wide notice"><b>${esc(t.title)}</b><p>${tr('公开授权', 'Public consent')}：${tr(
    t.public_consent ? '已同意' : '未同意',
    t.public_consent ? 'Granted' : 'Not granted'
  )}</p>${
    t.target_admin_id
      ? `<p>${tr('被投诉管理员', 'Reported administrator')} #${t.target_admin_id}</p>`
      : ''
  }${
    t.target_player_name
      ? `<p>${tr('被举报玩家', 'Reported player')}：${esc(t.target_player_name)} ${
          t.target_player_id ? '#' + t.target_player_id : tr('（自填）', '(entered)')
        }</p>`
      : ''
  }<div>${ticketBody(t.body)}</div>${
    t.replied_by ? `<p><b>${esc(replyAuthor(t))}</b> · ${date(t.replied_at)}</p>` : ''
  }${
    t.auto_reply
      ? `<div class="notice"><b>${tr(
          '灯灯 · 自动基础回复',
          'DengDeng · Automatic first reply'
        )}</b><p>${text(t.auto_reply)}</p></div>`
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
      ? `<p class="notice">${tr('承办奖励', 'Handler reward')}：${t.reward.amount} 💎 · ${tr(
          t.reward.paid ? '已发放' : '待绑定玩家后发放',
          t.reward.paid ? 'Paid' : 'Pending linked citizen'
        )} · ${tr('承办管理员', 'Assignee')} #${t.reward.admin_id}</p>`
      : ''
  }${ticketTimeline(t.history)}</div>`;
}

function triageBlock(trg) {
  return `<aside class="notice" id="internal-triage"><b>内部评估（仅管理端）</b><p>优先级：${esc(
    ({ low: '低', normal: '普通', high: '高', urgent: '紧急' })[trg.priority]
  )} · 紧急程度：${esc(
    ({ routine: '常规', time_sensitive: '需尽快处理', emergency: '紧急风险' })[trg.urgency]
  )} · 复杂度：${trg.complexity === 'complex' ? '复杂' : '一般'}</p><p>${text(
    trg.reason
  )}</p><small>${
    trg.source === 'ai' ? 'AI 判断' : trg.source === 'manual' ? '人工调整' : '规则判断'
  } · ${date(trg.updated_at)}</small></aside>`;
}

function feedbackBlock(t) {
  return `<aside class="notice"><b>回复反馈（内部监督）</b>${t.feedback
    .map(
      (f) =>
        `<p><b>${f.helpful ? '有用' : '未解决'}</b> · 回复记录 #${esc(f.target_id)} · ${date(
          f.updated_at
        )}<br>${esc(
          t.history?.find((e) => e.id === Number(f.target_id))?.actor_name || '客服回复'
        )} · ${esc(f.reason)} · ${text(f.comment)}</p>`
    )
    .join('')}</aside>`;
}

function ticketReplyForm(t, admins) {
  return (
    field('status', tr('状态', 'Status'), 'select', t.status, {
      options: ['open', 'in_progress', 'resolved', 'closed'],
    }) +
    field('priority', tr('优先级', 'Priority'), 'select', t.priority || 'normal', {
      options: ['low', 'normal', 'high', 'urgent'],
    }) +
    field('assignee_id', tr('指派管理员', 'Assign to'), 'select', t.assignee_id || '', {
      required: false,
      options: [
        ['', tr('未指派', 'Unassigned')],
        ...admins.admins.map((a) => [a.id, a.username]),
      ],
    }) +
    field('admin_reply', tr('回复内容', 'Reply'), 'textarea', t.admin_reply || '', {
      required: false,
    })
  );
}

function ticketPublicSettings(t) {
  return `<details class="wide"><summary>${tr(
    '公开处理设置',
    'Public processing settings'
  )}</summary><p class="muted">${tr(
    '只有提交者同意后才可公开。请先删除联系方式、无关个人信息等敏感内容；附件始终不公开。',
    'Consent is required. Remove contact details and unrelated personal information; attachments remain private.'
  )}</p>${field(
    'public_visible',
    tr('发布到公开处理列表', 'Publish to public feed'),
    'checkbox',
    t.public_visible
  )}${field(
    'public_title',
    tr('公开标题', 'Public title'),
    'text',
    t.public_title || t.title,
    { required: false, maxlength: 120 }
  )}${field(
    'public_body',
    tr('公开文字', 'Public text'),
    'textarea',
    t.public_body || t.body,
    { required: false }
  )}${field(
    'public_reply',
    tr('公开答复', 'Public reply'),
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
            tr('办结成功，10 绿宝石已发放至 ', 'Completed. 10 emeralds credited to ') +
              saved.reward.player_name
          );
        else if (saved.reward?.pending)
          toast(
            tr(
              '已办结，奖励将在承办人绑定玩家账号后发放',
              'Completed; reward is pending a linked citizen account'
            )
          );
        else toast(tr('已保存', 'Saved'));
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
    finish.textContent = tr('办结工单 · 奖励 10 💎', 'Complete ticket · 10 💎');
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
      `<p class="notice">${tr(
        '该工单涉及你本人，请由其他超管处理。',
        'This complaint involves you; another super administrator must handle it.'
      )}</p>`
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
          throw new Error('期间已有其他管理员调整分级，已保留人工设置，请刷新查看');
        if (d.triage) {
          $('[name=priority]', dialog).value = d.triage.priority;
          $('#internal-triage', dialog).innerHTML =
            '<b>内部评估（仅管理端）</b><p>' +
            esc(d.triage.priority + ' / ' + d.triage.urgency + ' / ' + d.triage.complexity) +
            '</p><p>' +
            text(d.triage.reason) +
            '</p><small>' +
            esc(d.triage.source === 'ai' ? 'AI 判断' : '规则判断') +
            '</small>';
          resume.remove();
        }
        toast('已恢复自动分级，回复草稿保留');
      });
  }
  attachAiEditor(dialog, { ticketId: t.id, targetName: 'admin_reply' });
  attachTicketInsights(dialog, t.id);
  if (isSuper()) {
    const history = document.createElement('button');
    history.type = 'button';
    history.textContent = tr('查看完整操作留痕', 'View complete audit');
    $('.modal-body > .actions', dialog).prepend(history);
    history.onclick = () => import('../../audit-ui.js').then(({ viewAudit }) => viewAudit('tickets', t.id));
  }
}