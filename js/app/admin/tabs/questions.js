/**
 * Questions tab.
 *
 * 模拟题库 CRUD + AI 出题入口。
 */

import { openExamAuthoring } from '../../exam-authoring.js';
import { adminContext } from '../state.js';
import {$,api,post,patch,modal,region,field,action} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  const aiButton = document.createElement('button');
  aiButton.textContent = '让 AI 出驾照题';
  aiButton.onclick = () => action(aiButton, () => openExamAuthoring(load));
  $('.toolbar', view).append(aiButton);

  const load = () =>
    region($('#records', view), () => api('/api/admin/exam-questions'), (d, box) => {
      attachExport(d.questions);
      table(
        box,
        [
          ['id', 'ID'],
          ['grade', '等级'],
          ['question', '题目'],
          ['answer', '答案'],
        ],
        d.questions,
        [{ key: 'edit', label: '改一改', run: edit }]
      );
    });

  function edit(q = {}) {
    modal(
      '题库演练',
      field('grade', '等级', 'select', q.grade || 'B', {
        options: ['B','A'],
      }) +
        field('q_type', '题型', 'select', q.q_type || 'choice', {
          options: ['choice','multi'],
        }) +
        field('question', '题目', 'textarea', q.question || '') +
        field(
          'options',
          '选项（一行一个，判断题留空）',
          'textarea',
          q.options ? JSON.parse(q.options).join('\n') : '',
          { required: false }
        ) +
        field(
          'answer',
          '正确答案（A / A|B / true / false）',
          'text',
          q.answer || ''
        ) +
        field('explanation', '解析', 'textarea', q.explanation || '', {
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