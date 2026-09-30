/**
 * 考试成绩复核。
 *
 * 处理两类题：
 *   1. AI 判不了的主观题（type === 'short'），等人来批
 *   2. 玩家主动提交的复核申请（appeals）
 *
 * 两条边界，后端也在管，这里只是前端不给绕过口子：
 *   - 原分数在确认前保留。复核是**覆盖**不是**累加**，提交带 revision 做乐观锁
 *   - 内部评分依据和内部说明不向玩家展示。所以「给玩家的复核答复」是
 *     一个独立字段（reply），不会不小心把 reason 泄出去
 *   - 不能复核自己的答卷（后端 403），前端不预判、也不做无谓提示
 *
 * 弹窗里只列**需要人看**的题：主观题 + 有 pending 申请的题。客观题全对了
 * 就不占地方了。
 */

import { $, $$, api, post, field, modal, esc, text, region, action, toast, date } from './core.js';

// 锁定的中文文案。提出具名常量只是为了让下面的 innerHTML 短一点 ——
// 文字本身逐字未改（COPY_LOCK.json 管的就是这些）。
const NOTICE =
  '处理 AI 无法可靠判定的题目和玩家主动申请的成绩复核。原分数在确认前保留；不能复核自己的答卷。内部评分依据与处理说明不向玩家展示，给玩家的答复单独填写。';

export async function renderExamReview(el) {
  el.innerHTML =
    '<h2>考试成绩复核</h2>' +
    `<p class="notice">${NOTICE}</p>` +
    '<div id="exam-review-list"></div>';

  const load = () =>
    region($('#exam-review-list', el), () => api('/api/admin/exam-review'), (d, box) => {
      box.innerHTML =
        d.sessions
          .map(
            (s) =>
              `<div class="row row-head">` +
              `<span>${esc(s.username)} · ${esc(s.grade)} 级 · ${s.pending_count} 题待批改复核 · ${
                s.appeal_count || 0
              } 个主动申请 · ${date(s.submitted_at)}</span>` +
              `<button data-exam-review="${s.id}">查看答卷与评分依据</button>` +
              `</div>`
          )
          .join('') || '<p>暂无待复核答卷。</p>';
      $$('[data-exam-review]', box).forEach((b) => {
        b.onclick = () => action(b, () => open(b.dataset.examReview));
      });
    });

  /** 答卷弹窗：需要复核的题 + 内部处理记录 */
  async function open(id) {
    const d = await api('/api/admin/exam-review?id=' + encodeURIComponent(id));
    const s = d.session;

    // 主观题要人判；客观题只有玩家申请了才需要看
    const pending = s.paper.questions.filter(
      (q) => q.type === 'short' || d.appeals.some((a) => a.question_id === q.id)
    );

    /** 一道题的完整展示：题干 / 考生答案 / 申请理由 / 内部评分依据 / 当前分 */
    const questionBlock = (q) => {
      const r = s.results.find((r) => r.question_id === q.id);
      const a = d.appeals.find((a) => a.question_id === q.id && a.status === 'pending');
      // 主观题答案是字符串；客观题是选项 id 数组，翻回选项文本
      const answer =
        q.type === 'short'
          ? s.answers[q.id] || '（未作答）'
          : (s.answers[q.id] || []).map((id) => q.options.find((o) => o.id === id)?.text || id).join('；');

      // 内部评分依据：主观题看评分要点，客观题标出正确选项
      const rubric =
        q.type === 'short'
          ? q.rubric.map((x) => `<p>${x.points} 分 · ${text(x.criterion)}</p>`).join('')
          : q.options
              .map((o) => `<p>${q.correct_option_ids.includes(o.id) ? '✓ ' : ''}${text(o.text)}</p>`)
              .join('');

      return (
        `<article class="panel">` +
        `<h3>${text(q.prompt)}</h3>` +
        `<p><b>考生回答：</b>${text(answer)}</p>` +
        (a
          ? `<aside class="notice">申请理由：${text(a.reason)}<p>申请时得分：${a.original_score}</p></aside>`
          : '') +
        `<details><summary>内部评分依据</summary>${rubric}</details>` +
        `<p>${r.score === null ? '待批改复核' : r.score + ' 分'}</p>` +
        // 待批改的、或玩家申请了的，才给复核按钮
        (r.status === 'pending_review' || a
          ? `<button type="button" data-grade-question="${q.id}">复核此题</button>`
          : '') +
        `</article>`
      );
    };

    const dialog = modal(
      '成绩复核 · ' + s.username,
      `<div class="wide">` +
        pending.map(questionBlock).join('') +
        `<h3>内部处理记录</h3>` +
        d.events
          .map(
            (e) =>
              `<p>${esc(e.actor_name)} · ${esc(e.action)} · ${date(e.created_at)}</p>` +
              `<pre class="wrap">${text(e.details)}</pre>`
          )
          .join('') +
        `</div>`,
      { wide: true }
    );

    $$('[data-grade-question]', dialog).forEach((b) => {
      b.onclick = () => {
        const questionId = b.dataset.gradeQuestion;
        const a = d.appeals.find((a) => a.question_id === questionId && a.status === 'pending');
        const r = s.results.find((r) => r.question_id === questionId);
        modal(
          '确认成绩复核',
          field('score', '确认得分（0–20）', 'number', r.score ?? 0, { min: 0, max: 20 }) +
            field('reason', '内部复核说明（仅管理员可见）', 'textarea', '', { maxlength: 500 }) +
            // 只有玩家主动申请过才问「给玩家怎么说」。没申请时 reply 传 undefined，
            // 后端就不写对外答复 —— 不会凭空多出一条玩家可见的说明。
            (a
              ? field('reply', '给玩家的复核答复（不要填写标准答案）', 'textarea', '', {
                  maxlength: 500,
                })
              : ''),
          {
            submit: async (v) => {
              await post('/api/admin/exam-review', {
                session_id: id,
                question_id: questionId,
                revision: s.revision,
                score: Number(v.score),
                reason: v.reason,
                reply: v.reply,
              });
              toast('复核已保存并留痕');
              await load();
            },
          }
        );
      };
    });
  }

  await load();
}
