/**
 * 共享表单字段原语。
 *
 * 输出的 HTML **逐字固定**，有测试直接断言（选中态、HTML 转义、
 * maxlength、required 的有无）。重构时改任何空格都可能让快照对不上。
 *
 * 可选能力（v80/v81 陆续加的，缺省时与原行为一致）：
 *   - opts.helper   字段下方的辅助说明
 *   - opts.error    字段错误状态，同时加 .field-error 让边框变红
 *   - opts.density  'compact' / 'spacious'
 */

import { escapeHtml } from './html.js';

export function formField(name, label, type = 'text', value = '', opts = {}) {
  const esc = escapeHtml;

  const densityClass =
    opts.density === 'compact' ? ' compact' : opts.density === 'spacious' ? ' spacious' : '';
  const errorClass = opts.error ? ' field-error' : '';

  // checkbox 不走这串属性 —— 它没有 value / maxlength，
  // 而且 required 加在勾选框上会变成「必须勾选」，语义不对
  const attrs =
    `name="${esc(name)}" id="field-${esc(name)}" ` +
    `${opts.required === false ? '' : 'required'} ` +
    `${opts.max !== undefined ? `max="${opts.max}"` : ''} ` +
    `${opts.min !== undefined ? `min="${opts.min}"` : ''} ` +
    `${opts.step ? `step="${opts.step}"` : ''}`;

  const options = (opts.options || [])
    .map((o) => {
      // 传 ['value','显示文字'] 或直接传一个值（后者走 optionLabel 翻译）
      const [v, l] = Array.isArray(o) ? o : [o, opts.optionLabel ? opts.optionLabel(o) : o];
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('');

  const content =
    type === 'textarea'
      ? `<textarea ${attrs} maxlength="${opts.maxlength || 2000}" rows="4">${esc(value)}</textarea>`
      : type === 'select'
      ? `<select ${attrs}>${options}</select>`
      : type === 'checkbox'
      ? `<input type="checkbox" name="${esc(name)}" id="field-${esc(name)}" ${value ? 'checked' : ''}>`
      : `<input type="${esc(type)}" ${attrs} value="${esc(value)}" maxlength="${opts.maxlength || 200}" ${
          type === 'password' ? 'autocomplete="new-password"' : ''
        }>`;

  const helpers =
    (opts.helper ? `<p class="form-helper">${esc(opts.helper)}</p>` : '') +
    (opts.error ? `<p class="form-error">${esc(opts.error)}</p>` : '');

  // 保留原样的两处空格：非 textarea / checkbox 时会渲染成 class="field  "
  // （双空格）。功能上等价于单空格，但为了输出逐字不变，这里照原样写。
  const wideClass = type === 'textarea' ? 'wide' : '';
  const checkClass = type === 'checkbox' ? 'check' : '';

  return `<label class="field ${wideClass} ${checkClass}${densityClass}${errorClass}"><span>${esc(
    label
  )}</span>${content}${helpers}</label>`;
}
