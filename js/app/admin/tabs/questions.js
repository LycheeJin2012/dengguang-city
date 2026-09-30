/**
 * 模拟题库 tab（questions）。
 *
 * 题库 CRUD + 「让 AI 出驾照题」入口（后者在 exam-authoring.js）。
 *
 * 两个不能改的行为：
 *   - options 在表单里是「一行一项」的文本，存之前切回数组。判断题留空
 *   - 读的时候要从 JSON 字符串 parse 回来（q.options 存的是 JSON 文本，
 *     不是数组）—— 这跟 exam-authoring.js 的草稿结构不一样，别照抄
 */

import { openExamAuthoring } from '../../exam-authoring.js';
import { adminContext } from '../state.js';
import {$,api,post,patch,modal,region,field,action} from '../../core.js'
import { table, toolbar, bindList, attachExport } from '../shared.js';

export async function render(loadActive) {
  const view = adminContext.root.querySelector('#admin-view');
  toolbar({ create: () => edit() }, () => loadActive());

  // AI 出题入口直接挂在工具栏末尾。开考生成 + 审核后回调 load 重画列表，
  // 这样新入库的题立刻能看到
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

  /** 新建 / 编辑题目。q 有 id 就是编辑。 */
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
          // ⚠️ 库里存的是 JSON 文本，进表单要先 parse
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
          // 表单里是文本，存回库里要是数组。空行丢掉，判断题因此可以留空
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