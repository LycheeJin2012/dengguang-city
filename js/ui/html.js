/**
 * HTML 转义 —— 把用户可控的文本变成可以安全塞进 innerHTML 的形式。
 *
 * 只有这一个职责，所以也只有一个导出。五个字符都要转：
 *   &  <  >     文本节点里会改变结构
 *   "  '        属性值里会提前闭合引号
 *
 * `?? ''` 兜住 null / undefined（它们拼进 HTML 会字面显示 "null"）；
 * 非字符串（数字、布尔）交给 String() 正常转成文本。
 *
 * 注意：这**不是**防 XSS 的全部。属性名、URL 协议（javascript:）、
 * CSS 上下文都不在覆盖范围内 —— 那些地方要靠别的方式挡。
 */

// 提到模块作用域：写在 replace 回调里等于每替换一个字符就新建一次对象。
const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const NEEDS_ESCAPE = /[&<>"']/g;

export const escapeHtml = (value) => String(value ?? '').replace(NEEDS_ESCAPE, (c) => ENTITIES[c]);
