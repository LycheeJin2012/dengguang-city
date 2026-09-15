/**
 * Questions tab.
 *
 * 模拟题库 CRUD + AI 出题入口。
 */

import { openExamAuthoring } from '../../exam-authoring.js';
import { adminContext } from '../state.js';
import {
  $,
  api,
  post,
  patch,
  modal,
  region,
  field,
  tr,
  action,
} from '../../core.js';
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  const aiButton = document.createElement('button');
  aiButton.textContent = tr('AI 出驾照题目', 'AI question authoring');
  aiButton.onclick = () => action(aiButton, () => openExamAuthoring(load));
  $('.toolbar', view).append(aiButton);

  const load = () =>
    region($('#records', view), () => api('/api/admin/exam-questions'), (d, box) => {
      attachExport(d.questions);
      table(
        box,
        [
          ['id', 'ID'],
          ['grade', tr('等级', 'Grade')],
          ['question', tr('题目', 'Question')],
          ['answer', tr('答案', 'Answer')],
        ],
        d.questions,
        [{ key: 'edit', label: tr('编辑', 'Edit'), run: edit }]
      );
    });

  function edit(q = {}) {
    modal(
      tr('模拟题库', 'Question bank'),
      field('grade', tr('等级', 'Grade'), 'select', q.grade || 'B', {
        options: ['B', 'A', 'S'],
      }) +
        field('q_type', tr('类型', 'Type'), 'select', q.q_type || 'choice', {
          options: ['choice', 'multi', 'judge'],
        }) +
        field('question', tr('题目', 'Question'), 'textarea', q.question || '') +
        field(
          'options',
          tr('选项（每行一项，判断题可留空）', 'Options (one per line; empty for true/false)'),
          'textarea',
          q.options ? JSON.parse(q.options).join('\n') : '',
          { required: false }
        ) +
        field(
          'answer',
          tr('答案（A / A|B / true / false）', 'Answer (A / A|B / true / false)'),
          'text',
          q.answer || ''
        ) +
        field('explanation', tr('解析', 'Explanation'), 'textarea', q.explanation || '', {
          required: false,
        }),
      {
        submit: async (d) => {
          d.options = d.options
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          await (q.id
            ? patch('/api/admin/exam-questions?id=' + q.id, d)
            : post('/api/admin/exam-questions', d));
          await load();
        },
      }
    );
  }

  await load();
}