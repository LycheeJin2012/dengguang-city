// v47: profile 驾照模拟题库 (选驾照等级 → 抽题 → 答题 → 看解释)
import { $, esc, GET, POST } from '../util.js?v=v46-fix-modules';

const GRADE_LABEL = { B: 'B 级（初级）', A: 'A 级（中级）', S: 'S 级（高级）' };

export async function renderExamCard() {
  const card = $('#examCard');
  const box = $('#examContent');
  if (!card || !box) return;
  card.style.display = '';

  box.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${['B', 'A', 'S'].map(g =>
        `<button class="btn btn-primary" data-grade="${g}">📝 练 ${GRADE_LABEL[g]}</button>`
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
      <h4 style="margin:0 0 8px 0">📕 错题本 (${w.length})</h4>
      ${w.length === 0 ? '<p class="muted">还没错题</p>' :
        `<ol style="padding-left:20px">${w.map(q =>
          `<li style="margin-bottom:6px"><b>${esc(GRADE_LABEL[q.grade] || q.grade)}</b>: ${esc(q.question.slice(0, 60))}${q.question.length > 60 ? '…' : ''}</li>`
        ).join('')}</ol>`}
    `;
  } catch (e) { console.warn('[profile/exam] load wrong book failed', e); }
}

async function startQuiz(grade) {
  const quiz = $('#examQuiz');
  quiz.innerHTML = '<p class="muted">抽题中…</p>';
  let qs;
  try {
    const d = await GET('/api/exam-questions?grade=' + grade + '&limit=5&random=1');
    qs = d.questions || [];
  } catch (e) { quiz.innerHTML = '<p style="color:var(--c-redstone)">✗ ' + e.message + '</p>'; return; }
  if (!qs.length) { quiz.innerHTML = '<p class="muted">' + GRADE_LABEL[grade] + ' 题库还是空的, 先练别的等级</p>'; return; }

  let idx = 0, correct = 0;
  const showOne = () => {
    const q = qs[idx];
    if (!q) {
      quiz.innerHTML = `<h4>🎉 答完啦! 答对 ${correct}/${qs.length}</h4><button class="btn btn-primary" id="examAgain">再来一组</button>`;
      quiz.querySelector('#examAgain')?.addEventListener('click', () => startQuiz(grade));
      return;
    }
    const opts = q.options || [];
    const isMulti = q.q_type === 'multi';
    const inputType = isMulti ? 'checkbox' : (q.q_type === 'judge' ? 'radio' : 'radio');
    quiz.innerHTML = `
      <div class="exam-q">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>第 ${idx + 1} / ${qs.length} 题 · ${esc(GRADE_LABEL[grade])}</b>
          <span style="font-size:12px;color:var(--c-stone-dark)">${isMulti ? '多选' : (q.q_type === 'judge' ? '判断' : '单选')}</span>
        </div>
        <p style="font-size:14px;line-height:1.5;margin:0 0 10px 0">${esc(q.question)}</p>
        <div class="exam-opts">
          ${q.q_type === 'judge'
            ? `<label style="display:block;margin:6px 0"><input type="radio" name="examOpt" value="true" /> 正确</label>
               <label style="display:block;margin:6px 0"><input type="radio" name="examOpt" value="false" /> 错误</label>`
            : opts.map((o, i) => {
                const letter = String.fromCharCode(65 + i);
                return `<label style="display:block;margin:6px 0;cursor:pointer"><input type="${inputType}" name="examOpt" value="${letter}" /> <b>${letter}.</b> ${esc(o)}</label>`;
              }).join('')}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button id="examSubmit" class="btn btn-primary">提交</button>
          <button id="examSkip" class="btn btn-ghost">跳过</button>
        </div>
        <div id="examResult" style="margin-top:10px"></div>
      </div>
    `;
    const submit = async () => {
      const chosen = Array.from(quiz.querySelectorAll('input[name=examOpt]:checked')).map(i => i.value);
      if (!chosen.length) { $('#examResult').innerHTML = '<p style="color:var(--c-redstone)">请先选答案</p>'; return; }
      const answer = isMulti ? chosen.join('|') : chosen[0];
      try {
        const r = await POST('/api/exam-questions/answer', { question_id: q.id, answer });
        if (r.is_correct) correct++;
        $('#examResult').innerHTML = `
          <p style="color:${r.is_correct ? 'var(--c-emerald)' : 'var(--c-redstone)'};font-weight:bold">${r.is_correct ? '✓ 答对了' : '✗ 答错了'}</p>
          <p>正确答案: <b>${esc(r.correct_answer)}</b></p>
          ${r.explanation ? `<p style="background:var(--c-bg-2);padding:6px 10px;border-left:3px solid var(--c-gold)">${esc(r.explanation)}</p>` : ''}
          <button class="btn btn-ghost btn-sm" id="examNext" style="margin-top:8px">下一题 →</button>
        `;
        quiz.querySelector('#examNext').onclick = () => { idx++; showOne(); };
      } catch (e) { $('#examResult').innerHTML = '<p style="color:var(--c-redstone)">✗ ' + e.message + '</p>'; }
    };
    quiz.querySelector('#examSubmit').onclick = submit;
    quiz.querySelector('#examSkip')?.addEventListener('click', () => { idx++; showOne(); });
  };
  showOne();
}
