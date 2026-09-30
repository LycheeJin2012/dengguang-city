/**
 * 操作留痕（audit）：谁在什么时候动过哪条记录。
 *
 * 这页是市政厅的 accountability 底线，所以有几个刻意的设计：
 *   - 只记**真动过手的操作和导出**。翻页面、登录、开详情都不算
 *   - 密码、令牌、附件原文一律不进台账（服务端就不写，前端也不该指望）
 *   - 表格里的 actor / resource 都是枚举键，映射不到就回落显示原始键，
 *     这样新增类型不会渲染成空白格
 *
 * 三种进入方式：
 *   auditRows()    纯渲染，其他 tab 的「经手记录」按钮复用
 *   viewAudit()    弹窗形态，看单条记录的经手过程
 *   renderAudit()  整个 tab 页，带筛选 + 快照式分页 + 导出
 *
 * 分页用的是「快照 + 游标」而不是 offset：留痕表随时在追加，offset 会漏行
 * 也可能重行。首次查询拿到的 snapshot 会一直带着往后翻，保证这一轮翻页
 * 看到的是一个稳定的时间切片。点「查」重置 snapshot，从头开始看最新数据。
 */

import { tableFrame } from '../ui/table.js';
import { $, $$, api, esc, date, field, modal, region, action, csv } from './core.js';

/** 动作名 → 中文。键是 audit_events.action 里的原始标识。 */
const ACTION_LABELS = {
  'map.saved': '存了地点 / 施工状态',
  'dm-send': '发了私信',
  'dm-read': '标了已读（旧记录）',
  'ticket.human_request_checked': '查过有没有人接手',
  'dm.auto_replied': '灯灯自动回话',
  'ai.draft_created': 'AI 起了草稿（没发）',
  'ticket.auto_replied': '自动基础回复',
  'ticket.human_requested': '玩家要求转人工',
  'ticket.player_followup': '玩家补了情况',
  'ticket.auto_assigned': '自动派单',
  'ticket.auto_deferred': '自动派单先按住',
  'dispatch.policy_changed': '改了派单规矩',
  post: '新建',
  patch: '改',
  delete: '删',
  'db.insert': '写入记录',
  'db.update': '更新记录',
  'db.delete': '删掉记录',
  'ticket.assigned': '派单',
  'ticket.replied': '回复了工单',
  'ticket.status_changed': '改了工单状态',
  'ticket.published': '挂上公开页',
  'ticket.unpublished': '撤下公开',
  'ui.export': '导出',
};

/** 操作者类型 → 中文 */
const ACTOR_LABELS = {
  system: '市政厅机器',
  admin: '市政厅',
  player: '市民',
  hotel_owner: '酒店老板',
  anonymous: '路人',
  applicant: '申请人',
};

/** 被操作对象类型 → 中文 */
const RESOURCE_LABELS = {
  city_places: '地点与施工',
  sessions: '登录会话',
  tickets: '工单',
  ticket_events: '办理记录',
  ticket_rewards: '办结奖励',
  players: '市民账号',
  admins: '市政厅账号',
  hotel_owners: '酒店老板账号',
  hotels: '酒店',
  hotel_rooms: '房型',
  bookings: '预订',
  notification_log: '通知',
  media_uploads: '附件',
  direct_messages: '私信',
};

/**
 * 留痕表格。
 *
 * 每格用 tableFrame 的 cell 结构（cell-label 只给窄屏用，cell-value 才是
 * 真正的内容）。「谁」「对象」两格是 身份 + #id + 名字 三段拼起来的，
 * 中间的 # 在 id 缺失时用长破折号占位。
 */
export function auditRows(events) {
  if (!events.length) {
    return `<div class="empty">${'这页还空着。翻页面、登录不算动过手。'}</div>`;
  }

  const cell = (label, body, extra = '') =>
    `<td role="cell"${extra}><span class="cell-label" aria-hidden="true">${label}</span>` +
    `<div class="cell-value">${body}</div></td>`;

  return tableFrame(
    ['时间', '谁', '动作', '对象', '结果', '明细'],
    events
      .map(
        (e) =>
          `<tr role="row">` +
          cell('时间', date(e.created_at)) +
          cell(
            '谁',
            `${esc(ACTOR_LABELS[e.actor_type] || e.actor_type)} #${e.actor_id || '—'} · ${esc(e.actor_name)}`
          ) +
          cell('动作', esc(ACTION_LABELS[e.action] || e.action)) +
          cell(
            '对象',
            `${esc(RESOURCE_LABELS[e.resource_type] || e.resource_type)} #${esc(e.resource_id || '—')}`
          ) +
          cell('结果', e.http_status || '—') +
          // 明细是后端塞进来的一整段 JSON，固定换行显示
          cell('明细', esc(e.details || ''), ' class="wrap"') +
          `</tr>`
      )
      .join('')
  );
}

/**
 * 弹窗形态的「经手记录」。各 tab 的列表按钮调这个。
 * @param {string} resourceType 资源类型键，对应 RESOURCE_LABELS 的键
 * @param {string|number} resourceId 资源 id
 */
export async function viewAudit(resourceType, resourceId) {
  const dialog = modal('经手记录', '<div class="wide" id="record-audit"></div>', { wide: true });
  await region(
    $('#record-audit', dialog),
    () =>
      api(
        '/api/admin/audit?resource_type=' +
          encodeURIComponent(resourceType) +
          '&resource_id=' +
          encodeURIComponent(resourceId)
      ),
    (d, el) => {
      el.innerHTML = auditRows(d.events);
    }
  );
}

/** 整个「操作留痕」tab：筛选 + 快照分页 + 全量导出 */
export async function renderAudit(el) {
  // snapshot 是首查返回的时间切片，null 表示还没查过（= 从最新开始）
  let snapshot = null;
  let cursor = null;

  el.innerHTML =
    `<h2>${'谁动过手'}</h2>` +
    `<p class="muted">${'只记真动过手的操作和导出，翻页面、登录不算。密码、令牌和附件原文一律不进来。'}</p>` +
    `<div class="toolbar">` +
    field('from', '从哪天', 'date', '', { required: false }) +
    field('to', '到哪天', 'date', '', { required: false }) +
    field('actor_type', '身份', 'select', '', {
      required: false,
      options: [
        ['', '全部'],
        ['player', '市民'],
        ['admin', '市政厅'],
        ['hotel_owner', '酒店老板'],
        ['system', '机器 / 灯灯'],
      ],
    }) +
    field('actor_id', '账号编号', 'number', '', { required: false, min: 1 }) +
    `<button id="audit-refresh">${'查'}</button>` +
    `<button id="audit-export">${'把筛选结果全导出来'}</button>` +
    `</div>` +
    `<div id="audit-rows"></div>` +
    `<button id="audit-next" hidden>${'再往后'}</button>`;

  /** 当前工具栏条件。只收有值的字段，空值不参与查询。 */
  const query = () => {
    const p = new URLSearchParams();
    $$('[name]', el).forEach((e) => {
      if (e.value) p.set(e.name, e.value);
    });
    return p;
  };

  const load = () =>
    region($('#audit-rows', el), () => {
      const q = query();
      // 翻页时必须带上首查的 snapshot，否则会漂移到追加进来的新记录上
      if (snapshot !== null) q.set('snapshot', snapshot);
      if (cursor) q.set('cursor', cursor);
      return api('/api/admin/audit?' + q);
    }, (d, box) => {
      snapshot = d.snapshot;
      cursor = d.next_cursor;
      box.innerHTML = auditRows(d.events);
      // 没有下一页游标就把「再往后」收起来
      $('#audit-next', el).hidden = !cursor;
    });

  // 「查」= 丢掉旧快照，从当前条件重新取最新一批
  $('#audit-refresh', el).onclick = () => {
    snapshot = null;
    cursor = null;
    load();
  };
  $('#audit-next', el).onclick = load;

  $('#audit-export', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      // 导出绕过界面分页：自己循环游标把整批捞完。
      // limit=1000 是服务端单页上限，翻页时 snapshot 一路沿用首查那个，
      // 否则导出期间新追加的记录会混进来、导致重复行。
      const result = [];
      let next = null;
      let cap = null;
      do {
        const q = query();
        q.set('limit', '1000');
        if (cap !== null) q.set('snapshot', cap);
        if (next) q.set('cursor', next);
        const d = await api('/api/admin/audit?' + q);
        result.push(...d.events);
        cap = d.snapshot;
        next = d.next_cursor;
      } while (next);
      await csv('light-city-operation-audit.csv', result);
    });

  await load();
}
