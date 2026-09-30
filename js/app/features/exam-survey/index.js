/**
 * 驾照模拟考试（问卷作答 + 交卷 + 成绩复核）。
 *
 * 原来这个文件只有 29 行、最长行 1885 字符：整个 `draw()` 的试卷 HTML 是一根
 * 模板串，答卷表单、阅卷意见、复核申请三块全部内联在里面。现在按
 * 「骨架 / 题目 / 阅卷意见 / 复核区」拆成几个纯函数，模板串按原位置切段，
 * 拼回去逐字相同。
 *
 * 四个不能改的行为，都是踩过坑的：
 *   1. `save()` 不是随手发请求，而是往一条 `queue` 链上串。
 *      自动保存（防抖 1200ms）、手动「保存进度」、「统一交卷」、「放弃试卷」
 *      四个入口共用这条链 —— 否则后发的旧答案会覆盖先发的新答案，交卷时
 *      revision 也会和后端对不上。链上先 `catch(()=>{})` 是为了让一次失败
 *      不再毒死后面所有排队中的保存。
 *   2. `save()` 里只在 `session === current` 时才更新 dirty 提示。保存请求
 *      回来时用户可能已经切了别的试卷，这时不能拿旧会话的状态去改新会话的
 *      提示语 —— 这是这一层的竞态守卫。
 *   3. 交卷时先把表单里所有 input/textarea/button 禁用，`finally` 里仅当
 *      会话没被换掉、状态还是 in_progress 才恢复。防止连点造成重复交卷。
 *   4. `watch()` 的 2500ms 轮询在 draw 一开始就被 clearTimeout 取消掉，
 *      否则重画后会有多个轮询同时回来互相覆盖。
 */

import { $, $$, api, post, patch, esc, text, action, date, modal, field, toast } from '../../core.js';

/** 题型码 → 中文，出现在题号后面 */
const labels = { choice: '单选题', multi: '多选题', short: '简答题' };

/** 可选的考试等级，顺序即按钮顺序 */
const GRADES = ['B', 'A'];

/** 会话状态 → 顶部状态行的一句话。顺序敏感：先判空、再判 in_progress。 */
function statusNote(s) {
  if (!s) return '请选择等级开始';
  if (s.status === 'in_progress') return '本次试卷可继续作答';
  if (s.status === 'generating') return '正在生成试卷…';
  if (s.status === 'grading') return '答卷已锁定，正在批改…';
  if (['completed', 'needs_review'].includes(s.status)) return '答卷已提交，不能再修改';
  return '本次试卷未完成';
}

/** 只有这两个状态还在服务端跑，别的状态不用轮询 */
const PENDING = ['generating', 'grading'];
/** 交卷定稿的两种状态。评分可能是 null（等人工复核） */
const FINAL = ['completed', 'needs_review'];

/** 顶部固定骨架：说明 + 选等级 + 状态行 + 试卷槽 + 历史槽 */
function skeletonMarkup() {
  const grades = GRADES.map((g) => `<button data-exam-grade="${g}">${g} 级 · 开始答卷</button>`).join('');
  return (
    '<h3>驾照模拟考试</h3>' +
    '<p class="notice">选择等级后即时生成本次问卷：2 道单选、1 道多选、2 道简答，共 100 分。' +
    '作答时不提供参考资料或答案，全部完成后统一交卷。此成绩不自动改变正式驾照审批。</p>' +
    `<div class="actions">${grades}</div>` +
    '<p role="status" id="exam-status"></p>' +
    '<div id="exam-paper"></div>' +
    '<h3>我的答卷记录</h3>' +
    '<div id="exam-history"></div>'
  );
}

/** 一道题的作答控件。简答是 textarea，选择题是 radio / checkbox。 */
function questionInput(q, s, editable) {
  if (q.type === 'short') {
    return (
      '<label>你的回答' +
      `<textarea data-short="${q.id}" maxlength="2000" rows="5" ${editable ? '' : 'disabled'}>` +
      `${esc(s.answers[q.id] || '')}</textarea></label>`
    );
  }
  const chosen = s.answers[q.id] || [];
  return q.options
    .map(
      (o) =>
        '<label class="survey-option">' +
        `<input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="q-${q.id}" ` +
        `value="${o.id}" ${chosen.includes(o.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}>` +
        `<span>${esc(o.text)}</span></label>`
    )
    .join('');
}

/** 交卷后每题下方的阅卷意见。没结果就没有这段。 */
function graderNote(s, q) {
  const r = s.results?.find((x) => x.question_id === q.id);
  if (!r) return '';
  const who =
    r.grader?.type === 'admin'
      ? ' · 管理员 #' + r.grader.id + ' ' + esc(r.grader.name)
      : r.grader?.type === 'ai'
        ? ' · AI 批改'
        : '';
  return (
    `<p class="notice">${r.score === null ? '待复核' : r.score + ' / 20 分'} · ${esc(r.feedback)}${who}</p>`
  );
}

/** 作答中才有的底部按钮组。已交卷时整段不输出。 */
const ACTION_BAR =
  '<div class="actions survey-actions">' +
  '<button type="button" id="exam-save">保存进度</button>' +
  '<button type="submit" class="primary">统一交卷</button>' +
  '<button type="button" id="exam-abandon">放弃本次试卷</button>' +
  '</div>' +
  '<p class="muted">输入后会自动保存。离开前请确认已显示“进度已保存”；' +
  '未作答的题目按 0 分处理。交卷后不能修改。</p>';

/** 试卷主体：标题行 + 进度/成绩 + 题目 + 操作条 */
function paperMarkup(s) {
  const editable = s.status === 'in_progress';
  const tag = editable ? '作答中' : s.status === 'needs_review' ? '简答待复核' : '已完成';

  // 作答中给进度条；已交卷给成绩文案。分数为 null 说明还有简答等人工复核。
  const progress = editable
    ? '<p id="exam-progress" aria-live="polite"></p><progress max="5" value="0" aria-label="答题进度"></progress>'
    : '<p class="notice">' +
      (s.score === null
        ? `已确认 ${s.known_score} 分，${s.pending_count} 道简答待复核，总分尚未确定。`
        : `本次得分 ${s.score} / 100`) +
      '</p>';

  const questions = s.questions
    .map(
      (q, i) =>
        '<fieldset class="survey-question">' +
        `<legend>${i + 1}. ${labels[q.type]} · ${q.max_score} 分</legend>` +
        `<p>${text(q.prompt)}</p>` +
        questionInput(q, s, editable) +
        (editable ? '' : graderNote(s, q)) +
        '</fieldset>'
    )
    .join('');

  return (
    '<section class="panel">' +
    `<div class="row-head"><h3>${esc(s.grade)} 级 · 本次答卷</h3><span>${tag}</span></div>` +
    progress +
    `<form id="exam-form">${questions}${editable ? ACTION_BAR : ''}</form>` +
    '</section>'
  );
}

/** 服务端还在跑时的占位面板。grading 额外给一个手动检查按钮。 */
function busyMarkup(s) {
  const generating = s.status === 'generating';
  return (
    '<div class="panel">' +
    `<h3>${generating ? '正在生成本次试卷' : '答卷已锁定，正在批改'}</h3>` +
    `<p>${generating ? '请稍候。刷新后也会继续这份试卷。' : '选择题由系统判分，简答题正在逐项评阅。'}</p>` +
    (generating ? '' : '<button id="recover-exam">检查批改进度</button>') +
    '</div>'
  );
}

/** 一道题在复核区的行：分数 + 已有申请，或一个「申请复核」按钮。 */
function appealRow(s, d, q, i) {
  const r = s.results?.find((x) => x.question_id === q.id);
  const a = d.appeals.find((x) => x.question_id === q.id);

  const score = r?.score === null ? '等待批改' : r?.score + ' 分';

  // 已申请过就只展示状态，不再给按钮 —— 每题只能申请一次
  const detail = a
    ? `<p>${a.status === 'pending' ? '复核处理中' : '已复核'} · 原得分 ${a.original_score}</p>` +
      `<p>你的理由：${text(a.reason)}</p>` +
      (a.reply ? `<p class="notice">复核答复：${text(a.reply)}</p>` : '')
    : r?.status === 'graded'
      ? `<button type="button" data-appeal-question="${q.id}">申请复核</button>`
      : '';

  return `<div class="row"><b>第 ${i + 1} 题</b> · ${score}${detail}</div>`;
}

export async function renderSurvey(el) {
  let session = null;
  let timer = null;
  // 串行保存链。见文件头说明 1：所有保存入口都必须经过它。
  let queue = Promise.resolve();
  let dirty = false;

  el.innerHTML = skeletonMarkup();

  /** 写状态行。页面被换掉之后就不再写，避免写到别人的节点上。 */
  const note = (message) => {
    if (el.isConnected) $('#exam-status', el).textContent = message;
  };

  /** 从 DOM 读出当前全部作答：简答取字符串，选择题取数组。 */
  function collect() {
    const result = {};
    if (!session?.questions) return result;
    for (const q of session.questions) {
      result[q.id] =
        q.type === 'short'
          ? $(`[data-short="${q.id}"]`, el)?.value || ''
          : $$(`[name="q-${q.id}"]:checked`, el).map((x) => x.value);
    }
    return result;
  }

  /** 刷新「已作答 n / N 题」和进度条。空作答（只有空串 / 空数组）不计入。 */
  function progress() {
    const a = collect();
    const n = Object.values(a).filter((v) => (typeof v === 'string' ? v.trim() : v.length)).length;
    $('#exam-progress', el).textContent = `已作答 ${n} / ${session.questions.length} 题`;
    $('progress', el).value = n;
  }

  /**
   * 排队保存一次作答。
   * 返回这条链，调用方 await 它就能保证「我这次保存」排在之前所有保存之后。
   */
  function save() {
    const current = session;
    if (!current || current.status !== 'in_progress') return queue;

    const answers = collect();
    // 链上前一次失败不该让这次直接跳过，所以先兜一层空 catch
    queue = queue.catch(() => {}).then(async () => {
      const r = await patch('/api/exam-sessions', {
        session_id: current.id,
        revision: current.revision,
        answers,
      });
      current.revision = r.revision;
      current.answers = answers;
      // 竞态守卫：回来时会话可能已经换了一份，这时不碰提示语
      if (session === current) {
        // 存的是发送那一刻的快照，回来时又比了一次 —— 不一致说明用户还在改
        dirty = JSON.stringify(collect()) !== JSON.stringify(answers);
        note(dirty ? '有新的修改，等待保存' : '进度已保存，可以稍后继续');
      }
    });
    return queue;
  }

  /** 生成 / 批改期间每 2.5 秒查一次。只对本次会话生效。 */
  function watch(id) {
    setTimeout(async () => {
      if (!el.isConnected || session?.id !== id || !PENDING.includes(session.status)) return;
      try {
        const d = await api('/api/exam-sessions?id=' + encodeURIComponent(id));
        draw(d.session);
        if (FINAL.includes(d.session.status)) await history();
      } catch (e) {
        note(e.message);
      }
    }, 2500);
  }

  function draw(s) {
    clearTimeout(timer);
    session = s;
    dirty = false;
    note(statusNote(s));

    const box = $('#exam-paper', el);
    // 试卷在跑的时候把选等级的按钮锁掉，避免同一时间开两份卷
    $$('[data-exam-grade]', el).forEach((b) => (b.disabled = !!s && PENDING.includes(s.status)));

    if (!s) {
      box.innerHTML = '';
      return;
    }

    if (PENDING.includes(s.status)) {
      box.innerHTML = busyMarkup(s);
      if (s.status === 'grading') {
        $('#recover-exam', el).onclick = (e) =>
          action(e.currentTarget, async () => {
            const d = await post('/api/exam-sessions', { action: 'recover', session_id: s.id });
            draw(d.session);
          });
      }
      watch(s.id);
      return;
    }

    if (s.status === 'failed' || s.status === 'abandoned') {
      box.innerHTML = '<p class="notice">本次试卷未完成，可以重新选择等级开始。</p>';
      return;
    }

    const editable = s.status === 'in_progress';
    box.innerHTML = paperMarkup(s);

    if (!editable) {
      mountAppeals(box, s, note);
      return;
    }

    progress();

    // 输入即防抖自动保存。timer 同时被 draw() 清掉，所以重画后不会有残留定时器
    $('#exam-form', el).oninput = () => {
      dirty = true;
      progress();
      note('正在编辑，等待保存…');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (el.isConnected) save().catch((e) => note('保存失败：' + e.message));
      }, 1200);
    };

    $('#exam-save', el).onclick = (e) =>
      action(e.currentTarget, async () => {
        clearTimeout(timer);
        await save();
      });

    $('#exam-form', el).onsubmit = (e) => {
      e.preventDefault();
      action($('[type=submit]', e.currentTarget), async () => {
        clearTimeout(timer);
        // 防连点：整张表单先禁用。恢复时确认会话没被换掉，否则会把新卷也锁死
        const controls = $$('input,textarea,button', e.currentTarget);
        controls.forEach((x) => (x.disabled = true));
        try {
          await save();
          const d = await post('/api/exam-sessions', {
            action: 'submit',
            session_id: s.id,
            revision: s.revision,
            answers: collect(),
          });
          draw(d.session);
          await history();
        } finally {
          if (session === s && session.status === 'in_progress') {
            controls.forEach((x) => (x.disabled = false));
          }
        }
      });
    };

    $('#exam-abandon', el).onclick = (e) =>
      action(e.currentTarget, async () => {
        clearTimeout(timer);
        // 必须等保存链排空再放弃，否则排队里的保存会打到已作废的会话上
        await queue.catch(() => {});
        await post('/api/exam-sessions', { action: 'abandon', session_id: s.id });
        draw(null);
        note('已放弃本次试卷，可以重新选择等级');
      });
  }

  /** 已交卷时追加在试卷下面的「申请成绩复核」区块。 */
  function mountAppeals(box, s, note) {
    const appeals = document.createElement('section');
    appeals.className = 'panel';
    appeals.innerHTML =
      '<h3>申请成绩复核</h3>' +
      '<p>对已批改题目的分数有异议，可说明原因申请复核。原成绩保留，等待管理员处理；每题可申请一次。</p>' +
      '<div id="exam-appeals"></div>';
    box.append(appeals);

    const loadAppeals = async () => {
      const d = await api('/api/exam-appeals?session_id=' + encodeURIComponent(s.id));
      // 重画后这个节点可能已经被移除
      if (!appeals.isConnected) return;

      $('#exam-appeals', appeals).innerHTML = s.questions
        .map((q, i) => appealRow(s, d, q, i))
        .join('');

      $$('[data-appeal-question]', appeals).forEach((b) => {
        b.onclick = () =>
          modal(
            '申请成绩复核',
            field('reason', '说明你认为评分需要复核的原因', 'textarea', '', { maxlength: 1000 }),
            {
              label: '提交复核申请',
              submit: async (v) => {
                await post('/api/exam-appeals', {
                  session_id: s.id,
                  question_id: b.dataset.appealQuestion,
                  reason: v.reason,
                });
                toast('复核申请已提交，原成绩保留');
                await loadAppeals();
              },
            }
          );
      });
    };

    loadAppeals().catch((e) => note(e.message));
  }

  /** 底部「我的答卷记录」，同时把当前未完成的会话带出去。 */
  async function history() {
    const d = await api('/api/exam-sessions');
    if (!el.isConnected) return;

    $('#exam-history', el).innerHTML =
      d.history
        .map(
          (h) =>
            '<div class="row row-head">' +
            `<span>${esc(h.grade)} 级 · ${date(h.submitted_at)} · ${h.score === null ? '待复核' : h.score + ' 分'}</span>` +
            `<button data-exam-history="${h.id}">查看答卷</button></div>`
        )
        .join('') || '<p class="muted">还没有已交答卷。</p>';

    $$('[data-exam-history]', el).forEach((b) => {
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          // 翻历史前先把本地改动刷上去，别让最后几秒的输入丢掉
          if (dirty) await save();
          const r = await api('/api/exam-sessions?id=' + encodeURIComponent(b.dataset.examHistory));
          draw(r.session);
        });
    });
    return d;
  }

  $$('[data-exam-grade]', el).forEach((b) => {
    b.onclick = (e) =>
      action(e.currentTarget, async () => {
        note('正在为你生成试卷…');
        const d = await post('/api/exam-sessions', { grade: b.dataset.examGrade });
        draw(d.session);
        note(d.resumed ? '已恢复尚未完成的试卷' : '本次试卷已生成');
      });
  });

  const d = await history();
  if (d?.active) draw(d.active);
}
