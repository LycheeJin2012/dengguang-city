/**
 * 知识库审核台（草稿 / 发布 / 撤回 / 版本历史 / 资料导入）。
 *
 * 原来这个文件 19 行、最长行 1284 字符：列表模板、版本历史弹窗、状态流转弹窗、
 * 编辑弹窗、导入弹窗全在同一个 `renderKnowledgeAdvanced` 里。现在按
 * 「骨架 / 卡片 / 三个弹窗」拆开，模板串按原位置切段。
 *
 * 不能改的行为：
 *   1. 两个按钮的禁用条件是**互为镜像**的：
 *        核对并发布 —— 原始资料失效 或 已发布 → disabled
 *        撤回       —— 不是 published        → disabled
 *      改成一个公共判断会让「已发布还能再点发布」这种状态出现。
 *   2. 「重新同步成草稿」只在 `source_kind !== 'manual'` 时出现：手写条目没有
 *      外部来源可同步。
 *   3. 发布弹窗必须勾「我核过事实、隐私和适用范围」才能提交，未勾时抛错。
 *      这条是内容安全的硬闸门，不能因为体验去掉。
 *   4. 状态流转走同一个 `patch`，只是 action 不同（publish / retract / refresh）。
 *      `confirm_review` 用 `!!v.review` 转换，撤回时自然是 false。
 *   5. 答案正文在列表里只显示前 240 字（`r.answer.slice(0,240)`），完整内容
 *      在编辑弹窗里看。别"顺手"改成全文，列表会撑爆。
 *   6. 「站点说明转草稿」是固定循环 id 1..6，逐个建草稿。这批 id 是站点内置
 *      说明的编号，改了会导错。
 *   7. 「重新载入」把 cursor 归零。
 */

import { $, $$, api, post, patch, field, modal, esc, text, region, action, toast, date } from '../../core.js';

/** 文章状态 → 中文 */
const STATUS_LABELS = {
  draft: '草稿待核',
  published: '已发布',
  retracted: '已撤回',
};

/** 受众 → 中文 */
const AUDIENCE_LABELS = {
  public: '公开答复',
  staff: '内部处理',
  exam: '考试资料',
};

/** 可导入的资料类型 → 中文 */
const SOURCE_LABELS = {
  announcement: '公告',
  license: '驾照规则',
  exam: '现有题目',
  ticket: '已办结工单',
};

const AUDIENCE_OPTIONS = [
  ['public', '公开答复'],
  ['staff', '内部处理'],
  ['exam', '考试资料'],
];

/** 状态流转按钮：attr 是 data 属性名，mode 是发给后端的 action */
const STATE_ACTIONS = [
  ['publish', 'publish'],
  ['retract', 'retract'],
  ['sync', 'refresh'],
];

function pageMarkup() {
  return (
    '<h2>知识库审核台</h2>' +
    '<p class="notice">新写的都先进草稿，核对过才发布、才被搜到。公开答复、内部处理、考试资料分开放；' +
    '原始资料一改就自动停用，得重新同步再核对。这里是给人查的检索库，不是拿去训模型的。</p>' +
    '<div class="actions">' +
    '<button id="kb-new">新建草稿</button>' +
    '<button id="kb-seed">站点说明转草稿</button>' +
    '<button id="kb-import">导入公告 / 规则 / 题库 / 工单</button>' +
    '<button id="kb-refresh">重新载入</button></div>' +
    '<div class="toolbar">' +
    field('kb-query', '拿玩家的问题试一下', 'text', '', { required: false, maxlength: 500 }) +
    '<button id="kb-test">试检索</button></div>' +
    '<div id="kb-result"></div>' +
    '<div id="kb-list"></div>' +
    '<button id="kb-next" hidden>下一页</button>'
  );
}

/** 一篇文章的卡片。两个禁用条件是互为镜像的，别合并。 */
function articleCard(r) {
  const canPublish = r.source_valid && r.status !== 'published';
  const canRetract = r.status === 'published';
  // 手写条目没有外部来源，"重新同步"这个动作对它没有意义
  const canSync = r.source_kind !== 'manual';

  return (
    '<article class="panel">' +
    '<div class="row-head">' +
    `<h3>#${r.id} ${esc(r.title)}</h3>` +
    `<span class="badge">${esc(STATUS_LABELS[r.status])} · ${esc(AUDIENCE_LABELS[r.audience])}</span>` +
    '</div>' +
    `<p>${text(r.question)}</p>` +
    // 列表只给前 240 字，完整正文在编辑弹窗里
    `<p>${text(r.answer.slice(0, 240))}</p>` +
    `<small>${esc(r.source_kind)} #${r.source_id || '—'} · v${r.revision} · ${date(r.updated_at)} ` +
    `${r.source_valid ? '' : ' · 原始资料变了，已停用'}</small>` +
    '<div class="actions">' +
    `<button data-history="${r.id}">版本与审核</button>` +
    `<button data-edit="${r.id}">改一改</button>` +
    `<button data-publish="${r.id}" ${canPublish ? '' : 'disabled'}>核对并发布</button>` +
    `<button data-retract="${r.id}" ${canRetract ? '' : 'disabled'}>撤回</button>` +
    (canSync ? `<button data-sync="${r.id}">重新同步成草稿</button>` : '') +
    '</div></article>'
  );
}

export async function renderKnowledgeAdvanced(el) {
  let cursor = null;
  el.innerHTML = pageMarkup();

  const load = () =>
    region($('#kb-list', el), () => api('/api/admin/knowledge' + (cursor ? '?cursor=' + cursor : '')), (d, box) => {
      box.innerHTML =
        d.articles.map(articleCard).join('') ||
        '<p class="empty">还什么都没有。先导入一批，或者手写一条草稿。</p>';

      $('#kb-next', el).hidden = !d.next_cursor;
      $('#kb-next', el).onclick = () => {
        cursor = d.next_cursor;
        load();
      };

      $$('[data-history]', box).forEach((b) => {
        b.onclick = () =>
          action(b, async () => {
            const d = await api('/api/admin/knowledge?action=history&id=' + b.dataset.history);
            const versions = d.versions
              .map(
                (v) =>
                  '<div class="panel">' +
                  `<b>v${v.revision} · 管理员 #${v.actor_id} ${esc(v.actor_name)}</b>` +
                  `<p>${esc(v.action)} · ${date(v.created_at)}</p>` +
                  `<pre class="wrap">${text(v.payload)}</pre></div>`
              )
              .join('');
            modal('这条改过哪几版', `<div class="wide">${versions}</div>`, { wide: true });
          });
      });

      $$('[data-edit]', box).forEach((b) => {
        b.onclick = () => edit(d.articles.find((r) => r.id === +b.dataset.edit));
      });

      for (const [attr, mode] of STATE_ACTIONS) {
        $$('[data-' + attr + ']', box).forEach((b) => {
          b.onclick = () => {
            const r = d.articles.find((r) => r.id === +b.dataset[attr]);
            // 撤回和同步共用同一个确认弹窗，但提示文案不同
            const hint =
              mode === 'publish'
                ? '确认内容属实、用得上；公开资料里不能出现私人信息或考试答案。'
                : '撤回或同步会立刻停用旧版本，同步回来的内容得重新核对。';
            modal(
              mode === 'publish' ? '核对这条知识' : '确认改状态',
              '<div class="wide">' +
                `<h3>${esc(r.title)}</h3>` +
                `<p>${text(r.answer)}</p>` +
                `<p class="notice">${hint}</p></div>` +
                (mode === 'publish' ? field('review', '我核过事实、隐私和适用范围', 'checkbox', false) : ''),
              {
                wide: true,
                label: mode === 'publish' ? '核对并发布' : '确认',
                submit: async (v) => {
                  // 发布必须显式勾选确认，这是内容安全的硬闸门
                  if (mode === 'publish' && !v.review) throw new Error('勾一下核对确认再发');
                  await patch('/api/admin/knowledge?id=' + r.id, {
                    revision: r.revision,
                    action: mode,
                    confirm_review: !!v.review,
                  });
                  await load();
                },
              }
            );
          };
        });
      }
    });

  function edit(r = {}) {
    modal(
      r.id ? '改这条知识（存完要重核一遍）' : '新建一条草稿',
      field('title', '标题', 'text', r.title || '', { maxlength: 150 }) +
        field('question', '玩家会怎么问', 'textarea', r.question || '', { maxlength: 1000 }) +
        field('answer', '答案正文（核对过的）', 'textarea', r.answer || '', { maxlength: 4000 }) +
        field('keywords', '关键词（空格隔开）', 'text', r.keywords || '', {
          required: false,
          maxlength: 300,
        }) +
        field('audience', '给谁看', 'select', r.audience || 'public', { options: AUDIENCE_OPTIONS }),
      {
        wide: true,
        submit: async (v) => {
          await (r.id
            ? patch('/api/admin/knowledge?id=' + r.id, { ...v, revision: r.revision })
            : post('/api/admin/knowledge', v));
          await load();
        },
      }
    );
  }

  $('#kb-new', el).onclick = () => edit();

  $('#kb-refresh', el).onclick = () => {
    cursor = null;
    load();
  };

  // 站点内置说明固定是 1..6 号，逐个转成草稿
  $('#kb-seed', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      for (let id = 1; id <= 6; id++) {
        await post('/api/admin/knowledge', { source_kind: 'guide', source_id: id });
      }
      toast('转成草稿了，还没发布');
      cursor = null;
      await load();
    });

  $('#kb-import', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      const d = await api('/api/admin/knowledge?action=sources');
      if (!d.sources.length) {
        toast('眼下没有能导入的资料');
        return;
      }
      modal(
        '挑一份资料（只生成草稿）',
        field('source', '资料', 'select', '', {
          options: d.sources.map(
            (s) => [s.kind + ':' + s.id, SOURCE_LABELS[s.kind] + ' #' + s.id + ' ' + s.title]
          ),
        }),
        {
          submit: async (v) => {
            const [source_kind, id] = v.source.split(':');
            await post('/api/admin/knowledge', { source_kind, source_id: Number(id) });
            await load();
          },
        }
      );
    });

  $('#kb-test', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      const d = await api(
        '/api/admin/knowledge?action=test&q=' + encodeURIComponent($('[name=kb-query]', el).value)
      );
      $('#kb-result', el).innerHTML =
        d.articles
          .map((r) => `<div class="notice"><b>#${r.id} ${esc(r.title)}</b><p>${text(r.answer)}</p></div>`)
          .join('') ||
        '<p class="notice">没搜到已核对、且原始资料没变的公开答案，客服会转人工核实。</p>';
    });

  await load();
}
