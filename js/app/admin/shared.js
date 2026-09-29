/**
 * Admin workspace shared utilities.
 *
 * v51 把 admin 后台整个塞进 admin.js 一个文件，里面有 table / toolbar /
 * bindList / params / attachExport / refreshStats / resourceList / signups
 * 一套共用工具，加上 12 个 tab 函数 + names/resources 数据表。共 521 行。
 *
 * 本文件把"所有 tab 都用到的工具"抽出来：
 *   - names / resources          → 数据表
 *   - isSuper / canHandleTicket  → 权限判断
 *   - refreshStats               → 仪表盘
 *   - table / toolbar / bindList / params / attachExport
 *                                → 通用 UI 工具
 *   - resourceList / signups     → 通用 tab 实现（tracks/hotels/.../bookings/kart/...）
 *
 * index.js 在启动时调用 setRouter({ switchTab, loadActive }) 注入路由函数，
 * 内部工具（refreshStats、toolbar、bindList 等）通过注入的回调切换页面，避免
 * 与 index.js 形成循环 import。
 *
 * tabs/tickets.js、tabs/players.js 等独立 tab 文件在本文件之上编写。
 */

import { adminContext } from './state.js';
import { navigationFor } from '../admin-navigation.js';
import {$,$$,api,post,patch,del,esc,date,status,empty,field,modal,region,action,toast,state,csv} from '../core.js'
import { tableCell, tableFrame } from '../../ui/table.js';
import { attachmentPicker, renderAttachments } from '../attachments.js';
import { viewAudit } from '../audit-ui.js';
import { openExamAuthoring } from '../exam-authoring.js';
import { renderMapAdmin } from '../city-map.js';
import { renderSupportChat } from '../support-chat-admin.js';
import { renderReplyFeedback } from '../reply-feedback-admin.js';
import { renderExamReview } from '../exam-review.js';
import { renderKnowledge } from '../knowledge-admin.js';
import { renderAudit } from '../audit-ui.js';
import { renderDispatchPolicy } from '../dispatch-policy.js';

// 路由注入：index.js 启动时调用，注入 switchTab / loadActive。
// 在 setRouter 调用之前，工具函数里如果触发到这些回调会抛 clear 错误。
let _router = null;
export function setRouter(router) {
  _router = router;
}

// Tab 显示名（中文 / 英文）。
export const names = {
  citymap: ['🗺️ 地图与施工', '🗺️ Map & works'],
  replyfeedback: ['👍 回复反馈', '👍 Reply feedback'],
  examreview: ['✍️ 成绩复核', '✍️ Exam review'],
  knowledge: ['📚 知识库', '📚 Knowledge base'],
  support: ['🎧 人工客服', '🎧 Human support'],
  owners: ['🔑 酒店经营账户', '🔑 Hotel owner accounts'],
  audit: ['📒 操作留痕', '📒 Operation audit'],
  dispatch: ['📋 派单', '📋 Dispatch'],
  questions: ['📚 模拟题库', '📚 Question bank'],
  tickets: ['🎫 工单中心', '🎫 Tickets'],
  players: ['👥 玩家管理', '👥 Citizens'],
  bookings: ['🏨 酒店预订', '🏨 Bookings'],
  kart: ['🛞 卡丁车报名', '🛞 Kart signups'],
  circuit: ['🏁 国际试车', '🏁 Circuit signups'],
  license: ['🚗 驾照报名', '🚗 License applications'],
  tracks: ['🏎️ 赛车场管理', '🏎️ Tracks'],
  hotels: ['🏡 酒店管理', '🏡 Hotels'],
  rooms: ['🛏️ 房型管理', '🛏️ Rooms'],
  requirements: ['📝 考试要求', '📝 Requirements'],
  announcements: ['📜 公告管理', '📜 Announcements'],
  gallery: ['🖼️ 图集管理', '🖼️ Gallery'],
  admins: ['🛡️ 管理员', '🛡️ Administrators'],
  dms: ['✉️ 私信监管', '✉️ DM moderation'],
  times: ['🏆 成绩审核', '🏆 Race verification'],
  password: ['🔑 账号安全', '🔑 Security'],
};

// 通用资源定义。resourceList() 根据这里的字段定义生成列表 + 编辑表单。
export const resources = {
  tracks: {
    path: 'race-tracks',
    key: 'tracks',
    fields: [
      ['name', '名字'],
      ['length_km','长度 km'],
      ['laps','跑了几圈'],
      ['difficulty', '难度'],
      ['trial_price','试车价格 💎'],
      ['description','介绍'],
      ['image_url', '图片地址'],
      ['sort_order','排序'],
      ['is_active','开放预订'],
    ],
  },
  hotels: {
    path: 'hotels',
    key: 'hotels',
    fields: [
      ['owner_id','经营账号'],
      ['name', '酒店名'],
      ['address', '地址'],
      ['description','介绍'],
      ['image_url', '图片地址'],
      ['sort_order','排序'],
      ['is_active','开放预订'],
    ],
  },
  rooms: {
    path: 'hotel-rooms',
    key: 'rooms',
    fields: [
      ['hotel_id','挂在哪间客栈'],
      ['name', '房型名字'],
      ['capacity','最多住几个'],
      ['beds', '床铺'],
      ['price_per_night','一晚多少钱 💎'],
      ['breakfast_included','带早饭'],
      ['description','介绍'],
      ['image_url', '图片地址'],
      ['sort_order','排序'],
      ['is_active','开放预订'],
    ],
  },
  requirements: {
    path: 'license-req',
    key: 'requirements',
    fields: [
      ['exam_type','考试类型'],
      ['title', '标题'],
      ['requirements','要求'],
      ['description','介绍'],
      ['min_age','最小年龄'],
      ['duration_minutes','考试分钟'],
      ['sort_order','排序'],
      ['is_active','开放预订'],
    ],
  },
  announcements: {
    path: 'announcements',
    key: 'announcements',
    fields: [
      ['title', '标题'],
      ['content','正文'],
      ['image_url', '封面图地址'],
    ],
  },
  gallery: {
    path: 'gallery',
    key: 'items',
    fields: [
      ['cat','归到哪一类'],
      ['is_featured','要上首页的图'],
      ['num','编号'],
      ['title', '标题'],
      ['caption','说明'],
      ['image_url', '图片地址'],
      ['sort_order','排序'],
      ['is_active','显示'],
    ],
  },
};

// 权限助手。canHandleTicket 排除了本人相关的工单。
export const isSuper = () => state.session?.user?.role === 'super';
export const canHandleTicket = (t) =>
  t.target_admin_id !== state.session?.user?.id &&
  (!t.target_player_id || t.target_player_id !== state.session?.user?.linked_player_id);

// 仪表盘：6 项统计 + 部分失败提示 + 更新时间。
// onSwitch(key) 由 index.js 注入，点统计跳到对应 tab。
export async function refreshStats(onSwitch) {
  const root = adminContext.root;
  const switchTab = onSwitch || _router?.switchTab;
  await region($('#admin-stats', root), () => api('/api/admin/dashboard'), (data, box) => {
    const racePending = data.kart && data.circuit ? data.kart.pending + data.circuit.pending : null;
    const stats = [
      ['players', data.players?.pending, '等人审核', 'Pending citizens'],
      ['tickets', data.tickets?.open, '等着办的', 'Pending tickets'],
      ['bookings', data.bookings?.pending, '等审客栈', 'Pending bookings'],
      ['license', data.license?.pending, '等审驾照', 'Pending licenses'],
      ['circuit', racePending, '等审赛道', 'Pending races'],
      ['players', data.players?.active, '常来的市民', 'Active citizens'],
    ];
    box.innerHTML = `<div class="stats">${stats
      .map(
        ([key, count, zh, en]) =>
          `<button class="stat" data-open="${key}"><strong>${count ?? '—'}</strong><span>${zh}</span>${
            count == null
              ? `<small>${'这会儿办不了，等会儿再来'}</small>`
              : ''
          }</button>`
      )
      .join('')}</div>${
      data.partial
        ? `<p class="form-error" role="status">${'部分统计暂时无法读取，其余功能仍可使用。可点击"刷新概览"重试。'}</p>`
        : ''
    }<small>${'什么时候改的'} ${date(new Date().toISOString())}</small>`;
    $$('[data-open]', box).forEach((button) => {
      button.onclick = () => {
        const key = button.dataset.open;
        // 统计按钮的 open key 可能是 'players'，要映射到 admin tab key
        const target = key === 'players' ? 'players' : key;
        switchTab?.(target);
      };
    });
  });
}

// 通用表格渲染。columns=[key,label,format?]，actions=[{key,label,when,run,danger}]。
export function table(box, columns, rows, actions = []) {
  box.innerHTML = rows.length
    ? tableFrame(
        [...columns.map(([, label]) => label), ...(actions.length ? ['受理'] : [])],
        `${rows
          .map(
            (r, i) =>
              `<tr role="row">${columns
                .map(([k, l, format]) =>
                  tableCell(
                    l,
                    format ? format(r[k], r) : esc(r[k] ?? '—'),
                    ['title', 'content', 'name', 'note', 'body'].includes(k) ? 'wrap' : ''
                  )
                )
                .join('')}${
                actions.length
                  ? `<td role="cell" class="table-actions"><span class="cell-label" aria-hidden="true">${'受理'}</span><div class="actions compact">${actions
                      .filter((a) => !a.when || a.when(r))
                      .map(
                        (a) =>
                          `<button type="button" data-row="${i}" data-action="${a.key}" class="${
                            a.danger ? 'danger' : ''
                          }">${esc(a.label)}</button>`
                      )
                      .join('')}</div></td>`
                  : ''
              }</tr>`
          )
          .join('')}`
      )
    : empty();
  $$('[data-action]', box).forEach((b) =>
    b.onclick = () =>
      action(b, () => actions.find((a) => a.key === b.dataset.action).run(rows[+b.dataset.row]))
  );
}

// 通用工具栏：搜索 + 状态过滤 + 新建 + 导出。
// onReload：刷新回调（index.js 的 loadActive）。
export function toolbar({ search = true, options = [], create, extra = '' } = {}, onReload) {
  const view = adminContext.view;
  const reload = onReload || _router?.loadActive;
  view.innerHTML = `<div class="section-head"><h2>${names[adminContext.active]}</h2><button id="reload-tab">↻ ${'重新载入'}</button></div><div class="toolbar">${
    search ? field('q', '查一下', 'search', '', { required: false }) : ''
  }${
    options.length
      ? field(
          'status',
          '状态',
          'select',
          '',
          { required: false, options: [['', '全部'], ...options] }
        )
      : ''
  }${create ? `<button id="create-record" class="primary">＋ ${'新建'}</button>` : ''}<button id="export">↓ CSV</button>${extra}</div><div id="records"></div>`;
  $('#reload-tab', view).onclick = () => reload?.();
  $('#create-record', view)?.addEventListener('click', create);
}

// 把搜索框 + 状态过滤框 input 事件绑到 load()，带 180ms 防抖。
export function bindList(load) {
  let timer;
  $$('.toolbar input,.toolbar select', adminContext.view).forEach((e) =>
    e.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 180);
    })
  );
  return load();
}

// 当前工具栏的查询参数（limit=200 + 搜索/状态过滤）。
export function params() {
  const p = new URLSearchParams({ limit: '200' });
  $$('.toolbar [name]', adminContext.view).forEach((e) => {
    if (e.value) p.set(e.name, e.value);
  });
  return p;
}

// 导出按钮：把当前 rows 写成 CSV 下载。rows 已经过滤/搜索过的。
export function attachExport(rows) {
  const view = adminContext.view;
  $('#export', view).onclick = () => csv(`light-city-${adminContext.active}.csv`, rows);
}

// 通用资源列表：tracks/hotels/rooms/requirements/announcements/gallery 共用。
export async function resourceList(def, deps = {}) {
  const reload = deps.reload || _router?.loadActive;
  const editor = async (item = {}) => {
    const defaults = {
      is_active: 1,
      capacity: 2,
      price_per_night: 0,
      trial_price: 0,
      sort_order: 0,
      laps: 1,
      num: 1,
      duration_minutes: 30,
      min_age: 0,
      exam_type: 'B',
      breakfast_included: 1,
    };
    let fields = def.fields
      .map(([key, label, type = 'text']) =>
        field(
          key,
          label,
          type,
          item[key] ?? defaults[key] ?? '',
          {
            required: ['name', 'title', 'content', 'hotel_id'].includes(key),
            min: type === 'number' ? 0 : undefined,
            step: key === 'length_km' ? '0.01' : undefined,
            options:
              key === 'cat'
                ? [
                    ['city', '城市'],
                    ['road', '道路'],
                    ['kart', '卡丁车'],
                    ['nature', '自然'],
                    ['announcement', '公告'],
                  ]
                : [
                    ['B', 'B 级'],
                    ['A', 'A 级'],
                    ['S', 'S 级'],
                    ['written', '笔试'],
                    ['road', '路考'],
                    ['upgrade', '换证考'],
                  ],
          }
        )
      )
      .join('');
    if (adminContext.active === 'hotels') {
      const owners = await api('/api/admin/hotel-owners');
      fields =
        def.fields
          .filter((f) => f[0] !== 'owner_id')
          .map(([key, label, type = 'text']) =>
            field(
              key,
              label,
              type,
              item[key] ?? defaults[key] ?? '',
              { required: key === 'name', min: 0 }
            )
          )
          .join('') +
        field(
          'owner_id',
          '指给哪位老板',
          'select',
          item.owner_id || '',
          {
            required: false,
            options: [
              ['', '还没派活'],
              ...owners.owners
                .filter((o) => o.status === 'active')
                .map((o) => [o.id, `#${o.id} · ${o.username}`]),
            ],
          }
        );
    }
    if (adminContext.active === 'rooms') {
      const h = await api('/api/admin/hotels');
      fields =
        field('hotel_id', '所属客栈', 'select', item.hotel_id || h.hotels[0]?.id, {
          options: h.hotels.map((h) => [h.id, h.name]),
        }) +
        def.fields
          .filter((f) => f[0] !== 'hotel_id')
          .map(([key, label, type = 'text']) =>
            field(
              key,
              label,
              type,
              item[key] ?? defaults[key] ?? '',
              { required: ['name','price_per_night'].includes(key), min: 0 }
            )
          )
          .join('');
    }
    let picker;
    const dialog = modal(
      item.id ? '改这条' : '新建一条',
      fields,
      {
        submit: async (d) => {
          if (picker) {
            const files = picker.files();
            if (files.length) d.image_url = files[0].url;
          }
          await (item.id
            ? patch('/api/admin/' + def.path + '?id=' + item.id, d)
            : post('/api/admin/' + def.path, d));
          picker?.commit();
          toast('存好了');
          await load();
        },
      }
    );
    if (def.fields.some((f) => f[0] === 'image_url'))
      picker = attachmentPicker(dialog, { purpose: 'public-image', max: 1 });
  };
  toolbar({ create: isSuper() ? () => editor() : null }, reload);
  const load = () =>
    region($('#records', adminContext.view), () => api('/api/admin/' + def.path), (d, box) => {
      let rows = d[def.key] || [];
      const q = $('[name=q]', adminContext.view).value.trim().toLowerCase();
      if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      attachExport(rows);
      table(
        box,
        [
          ['id', 'ID'],
          [
            def.key === 'announcements' || def.key === 'items' || def.key === 'requirements'
              ? 'title'
              : 'name',
            '名字',
          ],
          ...('is_active' in (rows[0] || {})
            ? [['is_active', '状态', (v) => status(v ? 'active' : 'pending')]]
            : []),
          ['updated_at', '什么时候改的', date],
        ],
        rows,
        isSuper()
          ? [
              { key: 'edit', label: '改一改', run: editor },
              {
                key: 'history',
                label: '经手记录',
                run: (r) =>
                  viewAudit(
                    (
                      {
                        hotels: 'hotels',
                        'hotel-rooms': 'hotel_rooms',
                        'race-tracks': 'race_tracks',
                        'license-req': 'license_requirements',
                        announcements: 'announcements',
                        gallery: 'gallery_items',
                      }
                    )[def.path],
                    r.id
                  ),
              },
              {
                key: 'delete',
                label: '移除',
                danger: true,
                run: async (r) => {
                  if (
                    !confirm(
                      '这条删不得——它身上还挂着别的记录。'
                    )
                  )
                    return;
                  await del('/api/admin/' + def.path + '?id=' + r.id);
                  await load();
                },
              },
            ]
          : []
      );
    });
  await bindList(load);
}

// 通用报名管理：bookings/kart/circuit/license 共用。
export async function signups(kind, deps = {}) {
  const reload = deps.reload || _router?.loadActive;
  const view = adminContext.root.querySelector('#admin-view');
  const opts =
    kind === 'bookings'
      ? ['pending', 'confirmed', 'completed', 'cancelled']
      : kind === 'license'
      ? ['pending','passed']
      : ['pending','approved'];
  toolbar({ options: opts }, reload);
  const load = () =>
    region($('#records', view), () => api('/api/admin/' + kind), (d, box) => {
      let rows = d.bookings || d.signups || [];
      const p = params();
      rows = rows.filter(
        (r) =>
          (!p.get('status') || r.status === p.get('status')) &&
          (!p.get('q') || JSON.stringify(r).includes(p.get('q')))
      );
      attachExport(rows);
      table(
        box,
        [
          ['id', 'ID'],
          ['player_username', '市民'],
          [
            kind === 'bookings' ? 'room_name' : kind === 'license' ? 'exam_type' : 'session',
            '项目',
          ],
          ['contact', '联系'],
          ['note', '补充说明'],
          ['status', '状态', status],
          ['created_at', '什么时候交的', date],
        ],
        rows,
        [
          {
            key: 'review',
            label: '受理',
            run: async (r) => {
              modal(
                '看看这份报名',
                field('status', '状态', 'select', r.status, { options: opts }) +
                  field('note', '补充说明', 'textarea', r.note || '', { required: false }),
                {
                  submit: async (values) => {
                    await patch(`/api/admin/${kind}?id=${r.id}&status=${values.status}`, values);
                    await load();
                    refreshStats();
                  },
                }
              );
            },
          },
        ]
      );
    });
  await bindList(load);
}

// navigationFor 是 admin-navigation.js 的再导出。
export { navigationFor };