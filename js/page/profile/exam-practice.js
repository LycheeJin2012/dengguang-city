// v47: profile 驾照模拟题库 (选驾照等级 → 抽题 → 答题 → 看解释)
// v50-N6: 全 i18n
import { $, esc, GET, POST } from '../util.js?v=v46-fix-modules';
import { t } from '../../i18n/core.js?v=n5';

// 工厂函数: 每次 render 时取当前语言的 grade label (跟 GRADE_LABEL 工厂函数模式一致)
const gradeLabel = (g) => ({
  B: t('exam.grade.B'),
  A: t('exam.grade.A'),
  S: t('exam.grade.S'),
}[g] || g);

export async function renderExamCard() {
  const card = $('#examCard');
  const box = $('#examContent');
  if (!card || !box) return;
  card.style.display = '';

  box.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${['B', 'A', 'S'].map(g =>
        `<button class="btn btn-primary" data-grade="${g}">📝 ${t('exam.btn.practice', '练')} ${esc(gradeLabel(g))}</button>`
      ).join('')}
    </div>
    <div id="examQuiz" style="margin-top:14px"></div>
    <div id="examWrong" style="margin-top:20px"></div>
  `;

  box.querySelectorAll('[data-grade]').forEach(b => {
    b.addEventListener('click', () => startQuiz(b.dataset.grade));
  });

  // 显示错题本
  try {
    const d = await GET('/api/exam-questions?my=1');
    const w = d.wrong_book || [];
    $('#examWrong').innerHTML = `
      <h4 style="margin:0 0 8px 0">📕 ${t('exam.wrongBook', '错题本')} (${w.length})</h4>
      ${w.length === 0 ? `<p class="muted">${t('exam.noWrong', '还没错题')}</p>` :
        `<ol style="padding-left:20px">${w.map(q =>
          `<li style="margin-bottom:6px"><b>${esc(gradeLabel(q.grade) || q.grade)}</b>: ${esc(q.question.slice(0, 60))}${q.question.length > 60 ? '…' : ''}</li>`
        ).join('')}</ol>`}
    `;
  } catch (e) { console.warn('[profile/exam] load wrong book failed', e); }
}

async function startQuiz(grade) {
  const quiz = $('#examQuiz');
  quiz.innerHTML = `<p class="muted">${t('exam.loading', '抽题中…')}</p>`;
  let qs;
  try {
    const d = await GET('/api/exam-questions?grade=' + grade + '&limit=5&random=1');
    qs = d.questions || [];
  } catch (e) { quiz.innerHTML = '<p style="color:var(--c-redstone)">✗ ' + e.message + '</p>'; return; }
  if (!qs.length) { quiz.innerHTML = `<p class="muted">${esc(gradeLabel(grade))} ${t('exam.emptyBank', '题库还是空的, 先练别的等级')}</p>`; return; }

  let idx = 0, correct = 0;
  const showOne = () => {
    const q = qs[idx];
    if (!q) {
      quiz.innerHTML = `<h4>🎉 ${t('exam.done', '答完啦!')} ${t('exam.correctRate', '答对')} ${correct}/${qs.length}</h4><button class="btn btn-primary" id="examAgain">${t('exam.btn.again', '再来一组')}</button>`;
      quiz.querySelector('#examAgain')?.addEventListener('click', () => startQuiz(grade));
      return;
    }
    const opts = q.options || [];
    const isMulti = q.q_type === 'multi';
    const inputType = isMulti ? 'checkbox' : (q.q_type === 'judge' ? 'radio' : 'radio');
    const qTypeLabel = isMulti ? t('exam.qType.multi', '多选') : (q.q_type === 'judge' ? t('exam.qType.judge', '判断') : t('exam.qType.single', '单选'));
    quiz.innerHTML = `
      <div class="exam-q">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>${t('exam.question', '第')} ${idx + 1} / ${qs.length} ${t('exam.questionOf', '题 · ')} ${esc(gradeLabel(grade))}</b>
          <span style="font-size:12px;color:var(--c-stone-dark)">${qTypeLabel}</span>
        </div>
        <p style="font-size:14px;line-height:1.5;margin:0 0 10px 0">${esc(q.question)}</p>
        <div class="exam-opts">
          ${q.q_type === 'judge'
            ? `<label style="display:block;margin:6px 0"><input type="radio" name="examOpt" value="true" /> ${t('exam.judgeTrue', '正确')}</label>
               <label style="display:block;margin:6px 0"><input type="radio" name="examOpt" value="false" /> ${t('exam.judgeFalse', '错误')}</label>`
            : opts.map((o, i) => {
                const letter = String.fromCharCode(65 + i);
                return `<label style="display:block;margin:6px 0;cursor:pointer"><input type="${inputType}" name="examOpt" value="${letter}" /> <b>${letter}.</b> ${esc(o)}</label>`;
              }).join('')}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button id="examSubmit" class="btn btn-primary">${t('exam.btn.submit', '提交')}</button>
          <button id="examSkip" class="btn btn-ghost">${t('exam.btn.skip', '跳过')}</button>
        </div>
        <div id="examResult" style="margin-top:10px"></div>
      </div>
    `;
    let submitted = false;
    const submit = async () => {
      if (submitted) return;
      const chosen = Array.from(quiz.querySelectorAll('input[name=examOpt]:checked')).map(i => i.value);
      if (!chosen.length) { $('#examResult').innerHTML = `<p style="color:var(--c-redstone)">${t('exam.pickFirst', '请先选答案')}</p>`; return; }
      const answer = isMulti ? chosen.join('|') : chosen[0];
      submitted = true;
      quiz.querySelector('#examSubmit').disabled = true;
      quiz.querySelector('#examSkip').disabled = true;
      try {
        const r = await POST('/api/exam-questions/answer', { question_id: q.id, answer });
        if (r.is_correct) correct++;
        $('#examResult').innerHTML = `
          <p style="color:${r.is_correct ? 'var(--c-emerald)' : 'var(--c-redstone)'};font-weight:bold">${r.is_correct ? '✓ ' + t('exam.correct', '答对了') : '✗ ' + t('exam.wrong', '答错了')}</p>
          <p>${t('exam.answer', '正确答案')}: <b>${esc(r.correct_answer)}</b></p>
          ${r.explanation ? `<p style="background:var(--c-bg-2);padding:6px 10px;border-left:3px solid var(--c-gold)">${esc(r.explanation)}</p>` : ''}
          <button class="btn btn-ghost btn-sm" id="examNext" style="margin-top:8px">${t('exam.btn.next', '下一题 →')}</button>
        `;
        quiz.querySelector('#examNext').onclick = () => { idx++; showOne(); };
      } catch (e) {
        submitted = false;
        quiz.querySelector('#examSubmit').disabled = false;
        quiz.querySelector('#examSkip').disabled = false;
        $('#examResult').innerHTML = '<p style="color:var(--c-redstone)">✗ ' + esc(e.message) + '</p>';
      }
    };
    quiz.querySelector('#examSubmit').onclick = submit;
    quiz.querySelector('#examSkip')?.addEventListener('click', () => { idx++; showOne(); });
  };
  showOne();
}
