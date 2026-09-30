/**
 * 灯灯的问答本（面向玩家的公开 FAQ，后台维护）。
 *
 * 原来这个文件只有 12 行、最长行 1119 字符：整页骨架、列表渲染、编辑弹窗、
 * 试用检索、折叠区全挤在一起。现在按「骨架 / 列表 / 编辑弹窗 / 试用」拆开。
 *
 * 不能改的行为：
 *   1. 「已启用」的判定是 `status === 'published' && source_valid` 两个条件同时
 *      成立。原始资料变过的条目即使还是 published 也显示「未启用」——这是
 *      内容安全的关键，只看 status 会让过期答案继续被灯灯引用。
 *   2. 编辑弹窗里那道拦截：`v.enabled && r.id && !r.source_valid` 时直接抛错，
 *      提示先同步再启用。新建（没有 r.id）不走这个检查。
 *   3. 保存分两步：先 patch/post 存正文，**再**单独发一次 publish。
 *      第二次的 revision 用 `r.id ? saved.revision : 1` —— 新建时还没有 revision。
 *   4. `values.title` 固定由 `question` 截前 150 字生成，不取用户填的标题
 *      （这个弹窗根本没有标题字段）。
 *   5. 停用走 `patch(... action:'retract')`；启用不走这里，而是 `edit(r, true)`
 *      重新打开弹窗让管理员再核一遍。不允许一键直接启用。
 *   6. 「更多」折叠区用 `advanced` 标志只初始化一次（ontoggle 会反复触发）。
 *   7. 「重新载入」要把 cursor 归零，否则刷新会停在原来那一页。
 */

import { $, $$, api, post, patch, field, modal, esc, text, region, action, toast } from '../../core.js';
import { renderKnowledgeAdvanced } from './advanced.js';

/** 整页骨架：说明 + 两个操作 + 试用框 + 列表 + 翻页 + 折叠区 */
function pageMarkup() {
  return (
    '<h2>灯灯的问答本</h2>' +
    '<p>把玩家真会问的问题和你核对过的答案写下来，启用后灯灯才敢说。' +
    '考试资料和内部信息不会出现在这儿。</p>' +
    '<div class="actions">' +
    '<button id="faq-add">新增问答</button>' +
    '<button id="faq-refresh">重新载入</button></div>' +
    '<div class="toolbar">' +
    field('faq-test', '拿一个问题试试', 'text', '', { required: false, maxlength: 500 }) +
    '<button id="faq-test-button">看灯灯能答什么</button></div>' +
    '<div id="faq-test-result"></div>' +
    '<div id="faq-list"></div>' +
    '<button id="faq-next" hidden>下一页</button>' +
    '<details id="faq-advanced"><summary>更多：导入资料、考试规则和历史记录</summary>' +
    '<div id="faq-advanced-body"></div></details>'
  );
}

export async function renderKnowledge(el) {
  let cursor = null;
  el.innerHTML = pageMarkup();

  /** 一条问答的卡片。徽章要同时看发布状态和原始资料有效性。 */
  function card(r) {
    const on = r.status === 'published' && r.source_valid;
    return (
      '<article class="panel">' +
      `<h3>${esc(r.question)}</h3>` +
      `<p>${text(r.answer)}</p>` +
      '<div class="actions">' +
      `<span class="badge">${on ? '已启用' : '未启用'}</span>` +
      `<button data-faq-edit="${r.id}">改一改</button>` +
      `<button data-faq-toggle="${r.id}">${r.status === 'published' ? '停用' : '启用'}</button>` +
      '</div></article>'
    );
  }

  const load = () =>
    region(
      $('#faq-list', el),
      () => api('/api/admin/knowledge?audience=public' + (cursor ? '&cursor=' + cursor : '')),
      (d, box) => {
        box.innerHTML =
          d.articles.map(card).join('') ||
          '<p class="notice">问答本还是空的。先新增一条，或者展开下面的「更多」导入站点说明。</p>';

        $('#faq-next', el).hidden = !d.next_cursor;
        $('#faq-next', el).onclick = () => {
          cursor = d.next_cursor;
          load();
        };

        $$('[data-faq-edit]', box).forEach((b) => {
          b.onclick = () => edit(d.articles.find((r) => r.id === +b.dataset.faqEdit));
        });

        $$('[data-faq-toggle]', box).forEach((b) => {
          b.onclick = () => {
            const r = d.articles.find((r) => r.id === +b.dataset.faqToggle);
            // 停用可以直接发；启用必须回弹窗重新核对，不给一键启用
            if (r.status === 'published') {
              action(b, async () => {
                await patch('/api/admin/knowledge?id=' + r.id, {
                  revision: r.revision,
                  action: 'retract',
                });
                await load();
              });
            } else {
              edit(r, true);
            }
          };
        });
      }
    );

  /** 新增 / 编辑。enable=true 来自「启用」按钮，勾选项默认打上。 */
  function edit(r = {}, enable = false) {
    modal(
      r.id ? '改这条问答' : '新增问答',
      field('question', '玩家会怎么问', 'textarea', r.question || '', { maxlength: 1000 }) +
        field('answer', '我核对过的答案', 'textarea', r.answer || '', { maxlength: 4000 }) +
        field('enabled', '启用它（内容我核过，可以给玩家用）', 'checkbox', enable || r.status === 'published'),
      {
        wide: true,
        submit: async (v) => {
          // 原始资料变过的老条目不许直接重新启用，必须先同步
          if (v.enabled && r.id && !r.source_valid) {
            throw new Error('原始资料变了，先在「更多」里同步再启用');
          }
          // 标题由问题截断生成，这个弹窗没有独立的标题字段
          const values = {
            question: v.question,
            title: v.question.slice(0, 150),
            answer: v.answer,
            audience: 'public',
            keywords: r.keywords || '',
          };
          const saved = r.id
            ? await patch('/api/admin/knowledge?id=' + r.id, { ...values, revision: r.revision })
            : await post('/api/admin/knowledge', values);
          // 发布是独立的第二次请求：新建时还没有 revision，只能用 1
          if (v.enabled) {
            await patch('/api/admin/knowledge?id=' + saved.id, {
              revision: r.id ? saved.revision : 1,
              action: 'publish',
              confirm_review: true,
            });
          }
          toast('问答存下了');
          await load();
        },
      }
    );
  }

  $('#faq-add', el).onclick = () => edit();

  $('#faq-refresh', el).onclick = () => {
    cursor = null;
    load();
  };

  $('#faq-test-button', el).onclick = (e) =>
    action(e.currentTarget, async () => {
      const d = await api(
        '/api/admin/knowledge?action=test&q=' + encodeURIComponent($('[name=faq-test]', el).value)
      );
      $('#faq-test-result', el).innerHTML =
        d.articles
          .map((r) => `<div class="notice"><b>${esc(r.title)}</b><p>${text(r.answer)}</p></div>`)
          .join('') || '<p class="notice">没搜到已启用且原始资料没变的问答，灯灯会请你转人工。</p>';
    });

  // ontoggle 会随展开/收起反复触发，用这个标志保证只初始化一次
  let advanced = false;
  $('#faq-advanced', el).ontoggle = () => {
    if (!advanced && $('#faq-advanced', el).open) {
      advanced = true;
      renderKnowledgeAdvanced($('#faq-advanced-body', el));
    }
  };

  await load();
}
