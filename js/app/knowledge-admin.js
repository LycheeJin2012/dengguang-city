/**
 * 灯灯问答后台的向后兼容转发层（v79-6）。
 *
 * 实现已经搬到 js/app/features/knowledge/admin.js —— 那次拆分只修正了
 * import 路径，没有动逻辑。本文件留作转发，让
 * `import { renderKnowledge } from './knowledge-admin.js'` 继续可用
 * （admin/index.js 的 loadActive 就是这么引的）。
 *
 * ⚠️ 只转发，不加逻辑。改知识库相关的东西去 features/knowledge/admin.js。
 */

export { renderKnowledge } from './features/knowledge/admin.js';
