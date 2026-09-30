/**
 * AI 搭把手：给客服工单弹窗挂一个「起草 / 改写 / 列要点」的侧栏。
 *
 * 原来这个文件 13 行、最长行 724 字符：一个 1000 多字符的模板串 + 一个
 * generation 计数器挤在一起。现在把「面板骨架」「依据说明」拆开。
 *
 * 不能改的行为，三个都是防误操作的：
 *   1. **`generation` 是一次性 epoch**。每次点「起草/改写/列要点」都 `++generation`，
 *      请求回来时 `revision !== generation` 就直接丢弃。防止慢的旧请求覆盖新结果
 *      —— 用户连点两次，第二次先回来时，第一次的草稿会盖掉它。
 *   2. **「填进回复框」只在目标框的内容没被手改过时可用**。生成时记一份
 *      `snapshot`，点击时对比 `target.value !== snapshot` 就不填，并提示用户
 *      重新生成。这是为了不覆盖用户自己在回复框里写的新内容。
 *   3. 「列要点」模式下按钮是禁用的（`disabled = mode === 'summary'`）：要点是
 *      给人看的提纲，不是能直接当回复正文发出去的内容。
 *   4. 面板优先插在目标字段的 label 后面；`closest('label')` 找不到时兜底挂到
 *      表单末尾。
 */

import { $, post, field, action, toast } from './core.js';

/** 侧栏骨架。只出一次，之后只换内容。 */
function panelMarkup() {
  return (
    '<summary>AI 搭把手：起草、改写、列要点</summary>' +
    '<p class="muted">它只写草稿，不会替你发出去。事实、时间、承诺都要自己核。</p>' +
    field('ai-instructions', '想让它怎么写', 'textarea', '', { required: false, maxlength: 1000 }) +
    '<div class="actions">' +
    '<button type="button" data-ai-mode="reply">起草回复</button>' +
    '<button type="button" data-ai-mode="rewrite">改写这段</button>' +
    '<button type="button" data-ai-mode="summary">列要点</button></div>' +
    field('ai-preview', '草稿（还没发）', 'textarea', '', { required: false }) +
    '<p class="muted" role="status" data-ai-note></p>' +
    '<button type="button" data-ai-apply disabled>填进回复框</button>'
  );
}

/** 提示行 = 后端给的说明 + 引用到的知识条目 */
function noteText(r) {
  const sources = (r.sources || [])
    .map((s) => '知识 #' + s.id + ' v' + s.revision + ' ' + s.title)
    .join('；');
  return r.note + (sources ? ' 依据：' + sources : '');
}

/**
 * 给一个弹窗挂上 AI 侧栏。
 * @param {Element} dialog      目标弹窗
 * @param {object}  opts
 * @param {number}  opts.ticketId    关联工单 id（写进请求，服务端据此取上下文）
 * @param {string}  opts.targetName  目标输入框的 name
 * @param {string}  [opts.endpoint]  请求地址，默认后台草稿接口
 * @param {string}  [opts.context]   额外上下文（通常是工单正文）
 */
export function attachAiEditor(dialog, { ticketId, targetName, endpoint = '/api/admin/ai-draft', context = '' }) {
  const target = $(`[name=${targetName}]`, dialog);

  const panel = document.createElement('details');
  panel.className = 'wide ai-editor';
  panel.innerHTML = panelMarkup();

  // 优先挂在目标字段的 label 后面；结构变了兜底挂到表单末尾
  target.closest('label')?.after(panel);
  if (!panel.isConnected) $('form', dialog).append(panel);

  let snapshot = '';
  let generation = 0;

  panel.querySelectorAll('[data-ai-mode]').forEach((button) => {
    button.onclick = (e) =>
      action(e.currentTarget, async () => {
        // 纪下这次是第几代；回来时不是最新一代就丢弃
        const revision = ++generation;
        const current = target.value;
        panel.querySelector('[data-ai-apply]').disabled = true;

        const r = await post(endpoint, {
          ticket_id: ticketId,
          content: context,
          mode: button.dataset.aiMode,
          instructions: $('[name=ai-instructions]', panel).value,
          existing: current,
        });

        // 竞态守卫：期间又点了一次别的模式，或弹窗已经关了
        if (revision !== generation || !dialog.isConnected) return;

        snapshot = current;
        $('[name=ai-preview]', panel).value = r.draft;
        $('[data-ai-note]', panel).textContent = noteText(r);
        // 要点是提纲不是回复正文，不给「填进回复框」
        panel.querySelector('[data-ai-apply]').disabled = button.dataset.aiMode === 'summary';
      });
  });

  $('[data-ai-apply]', panel).onclick = () => {
    // 用户手改过回复框就不能直接盖，得重新生成一份
    if (target.value !== snapshot) {
      toast('你手改过回复框了，重新生成一份再填，别盖掉新写的');
      return;
    }
    target.value = $('[name=ai-preview]', panel).value;
    toast('填好了，存下才真的发出去');
  };
}
