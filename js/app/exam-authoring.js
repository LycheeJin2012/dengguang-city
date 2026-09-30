/**
 * AI 驾照出题：生成草稿 → 人工逐题核对 → 入库。
 *
 * 从「模拟题库」tab 的工具栏按钮调进来（questions.js 里那个
 * 「让 AI 出驾照题」），所以它是个弹窗而不是整页。
 *
 * 硬规矩，代码里不要绕过：
 *   - 只用**已审核**的灯光市考试资料做依据，选项列表由服务端给出，前端不自己找
 *   - 生成的一律是**待审草稿**，不会自动进玩家题库
 *   - 入库必须人工勾「已核对题目、答案、解析与适用规则」，没勾就抛错拦住
 *
 * 审核弹窗里的「确认得分」式字段名要和题库 CRUD（questions.js）保持一致：
 * grade / q_type / question / options / answer / explanation。
 */

import { $, $$, api, post, field, modal, esc, text, action, toast } from './core.js';

/** 选项在预览里的编号：A、B、C…（按序号从 'A' 推） */
const optionLetter = (index) => String.fromCharCode(65 + index);

export async function openExamAuthoring(onSaved) {
  const data = await api('/api/admin/exam-ai');

  const dialog = modal(
    'AI 驾照出题 · 先审核再入库',
    `<div class="wide notice">只使用已审核的灯光市考试资料。选择依据后生成 1–5 题；题干、答案与解析都需人工核对。不会自动加入玩家题库。</div>` +
      field('grade', '等级', 'select', 'B', { options: ['B', 'A'] }) +
      field('q_type', '题型', 'select', 'choice', {
        options: [
          ['choice', '单选'],
          ['multi', '多选'],
          ['judge', '判断'],
        ],
      }) +
      field('count', '数量', 'number', 3, { min: 1, max: 5 }) +
      field('focus', '考点 / 难度 / 出题要求', 'textarea', '', { required: false, maxlength: 1000 }) +
      `<fieldset class="wide"><legend>出题依据（最多选 8 条）</legend>${
        data.knowledge
          .map(
            (k) =>
              `<label class="field check"><input type="checkbox" name="knowledge_id" value="${k.id}">#${k.id} ${esc(
                k.title
              )} · v${k.revision}</label>`
          )
          .join('') ||
        '<p>没有可用的考试资料。请让超管到“知识库”导入驾照规则或现有题目，审核为“考试资料”后再出题。</p>'
      }</fieldset>` +
      `<div class="wide actions"><button type="button" id="generate-exam">生成待审题目</button></div>` +
      `<div class="wide" id="exam-drafts"></div>`,
    { wide: true }
  );

  /** 画草稿列表。生成完和初次打开都走这里。 */
  const draw = (drafts) => {
    $('#exam-drafts', dialog).innerHTML =
      drafts
        .map(
          (d) =>
            `<article class="panel">` +
            `<h3>待审草稿 #${d.id} · ${esc(d.payload.grade)}</h3>` +
            `<p>${text(d.payload.question)}</p>` +
            // 选项逐行编号，和审核框里手写的 A/B/C 对得上
            `<p>${text(
              d.payload.options.map((x, i) => optionLetter(i) + '. ' + x).join('\n')
            )}</p>` +
            `<p>建议答案：${esc(d.payload.answer)}</p>` +
            `<p>${text(d.payload.explanation)}</p>` +
            `<small>依据：${d.sources
              .map((s) => '知识 #' + s.id + ' v' + s.revision + ' ' + esc(s.title))
              .join('；')}</small>` +
            `<div class="actions"><button type="button" data-exam-review="${d.id}">逐题审核 / 编辑 / 入库</button></div>` +
            `</article>`
        )
        .join('') || '<p>尚无待审草稿。</p>';
    $$('[data-exam-review]', dialog).forEach((b) => {
      b.onclick = () => review(drafts.find((d) => d.id === +b.dataset.examReview));
    });
  };

  /** 逐题审核弹窗。改完确认才写库。 */
  function review(d) {
    const q = d.payload;
    modal(
      '审核 AI 驾照题目',
      field('grade', '等级', 'select', q.grade, { options: ['B', 'A'] }) +
        field('q_type', '题型', 'select', q.q_type, {
          options: [
            ['choice', '单选'],
            ['multi', '多选'],
            ['judge', '判断'],
          ],
        }) +
        field('question', '题干', 'textarea', q.question) +
        field('options', '选项（每行一项，判断题留空）', 'textarea', q.options.join('\n'), {
          required: false,
        }) +
        field('answer', '正确答案（A / A|B / true / false）', 'text', q.answer) +
        field('explanation', '解析与规则依据', 'textarea', q.explanation) +
        field('review', '已核对题目、答案、解析与适用规则', 'checkbox', false),
      {
        wide: true,
        label: '确认审核并加入题库',
        submit: async (v) => {
          // 不勾确认就到这里结束：AI 的产出不能没人看一眼就进题库
          if (!v.review) throw new Error('请先勾选审核确认');
          await post('/api/admin/exam-ai', {
            action: 'save',
            draft_id: d.id,
            confirm_review: true,
            question: {
              ...v,
              // 选项在表单里是「一行一项」的文本，入库前切回数组；空行丢掉
              options: v.options
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            },
          });
          toast('题目已入库并留痕');
          await onSaved();
        },
      }
    );
  }

  $('#generate-exam', dialog).onclick = (e) =>
    action(e.currentTarget, async () => {
      const ids = $$('input[name=knowledge_id]:checked', dialog).map((x) => Number(x.value));
      const d = await post('/api/admin/exam-ai', {
        grade: $('[name=grade]', dialog).value,
        q_type: $('[name=q_type]', dialog).value,
        count: Number($('[name=count]', dialog).value),
        focus: $('[name=focus]', dialog).value,
        knowledge_ids: ids,
      });
      draw(d.drafts);
      toast(d.note);
    });

  draw(data.drafts);
}
