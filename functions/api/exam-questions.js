import { endpoint, identity, body, string, integer, reply, fail } from '../_core/request.js';

/** 题库等级：B 初级 / A 中级 / S 高级 */
const GRADES = ['B', 'A', 'S'];

/** 题型：单选 / 多选 / 判断 */
const TYPES = ['choice', 'multi', 'judge'];

export const onRequestGet = (context) =>
  endpoint(async () => {
    const url = new URL(context.request.url);

    // ?my=1 走练习记录，返回历史作答与去重后的错题本
    if (url.searchParams.get('my') === '1') {
      const player = await identity(context);
      const rows = await context.env.DB
        .prepare(
          'SELECT q.id,q.grade,q.question,a.is_correct,a.created_at FROM exam_attempts a JOIN exam_questions q ON q.id=a.question_id WHERE a.player_id=? ORDER BY a.id DESC LIMIT 100'
        )
        .bind(player.id)
        .all();

      // Map 天然去重：同一题错多次只留最近那条（行已按 a.id DESC 排序）
      const wrong = new Map();
      for (const row of rows.results) {
        if (!row.is_correct && !wrong.has(row.id)) wrong.set(row.id, row);
      }

      return reply({
        attempts: rows.results,
        wrong_book: [...wrong.values()],
      });
    }

    const grade = url.searchParams.get('grade');
    if (!GRADES.includes(grade)) fail(400, '请选择 B/A/S 等级');
    const limit = integer(url.searchParams.get('limit') || 10, 'limit', 1, 50);

    // random=1 换成 RANDOM() 打乱；ORDER BY 里的分支只认这一个开关，不接受外部传值
    const order = url.searchParams.get('random') === '1' ? 'RANDOM()' : 'id';
    const rows = await context.env.DB
      .prepare(
        `SELECT id,grade,q_type,question,options FROM exam_questions WHERE grade=? ORDER BY ${order} LIMIT ?`
      )
      .bind(grade, limit)
      .all();

    return reply({
      // options 存的是 JSON 文本，取题时顺手解析；judge 题本来就没有选项
      questions: rows.results.map((r) => ({ ...r, options: r.options ? JSON.parse(r.options) : [] })),
    });
  });

/**
 * 校验并归一化一道题。
 *
 * 之所以单独导出：后台的 AI 出题草稿也要过同一套规则，
 * 两边各校验一次迟早会漂移。
 */
export function validateQuestion(input) {
  const grade = string(input.grade, '等级', 1);
  const qType = input.q_type || 'choice';
  if (!GRADES.includes(grade) || !TYPES.includes(qType)) fail(400, '题目等级或类型无效');

  const question = string(input.question, '题目', 2000);
  const answer = string(input.answer, '答案', 50);

  // options 允许直接传 JSON 文本（表单场景），解析失败就当格式错
  let options = input.options || [];
  if (typeof options === 'string') {
    try {
      options = JSON.parse(options);
    } catch {
      fail(400, '选项必须是 JSON 数组');
    }
  }

  if (
    qType !== 'judge' &&
    (!Array.isArray(options) ||
      options.length < 2 ||
      options.length > 26 ||
      options.some((x) => typeof x !== 'string' || x.length > 500))
  ) {
    fail(400, '需提供 2–26 个文字选项');
  }

  if (qType === 'judge' && !['true', 'false'].includes(answer)) fail(400, '判断题答案需 true/false');

  // 选择题的答案只能是选项字母（逗号/竖线/空格分隔），且不能指到不存在的选项
  if (
    qType !== 'judge' &&
    (!/^[A-Z,|\s]+$/i.test(answer) ||
      [...answer.toUpperCase().replace(/[,|\s]/g, '')].some((c) => c.charCodeAt(0) - 65 >= options.length))
  ) {
    fail(400, '答案必须对应选项字母');
  }

  return {
    grade,
    q_type: qType,
    question,
    options: JSON.stringify(options),
    answer,
    explanation: string(input.explanation ?? '', '解析', 2000, { required: false }),
  };
}

export const onRequestPost = (context) =>
  endpoint(async () => {
    await identity(context, 'admin');
    const validated = validateQuestion(await body(context.request));
    // 对象键顺序与 INSERT 的列顺序一一对应，不能改
    const created = await context.env.DB
      .prepare(
        'INSERT INTO exam_questions(grade,q_type,question,options,answer,explanation) VALUES(?,?,?,?,?,?)'
      )
      .bind(...Object.values(validated))
      .run();
    return reply({ id: created.meta.last_row_id }, 201);
  });
