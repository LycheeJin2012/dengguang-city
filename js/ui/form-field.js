/**
 * Shared form-field component.
 *
 * v81 起新增：
 *   - opts.helper   字段下方的辅助说明（v80 `.form-helper`）
 *   - opts.error    字段错误状态（v80 `.form-error`，同时加 `.field-error` 让边框变红）
 *   - opts.density  'compact' / 'spacious'（v80 `.field.compact` 等）
 *
 * 旧签名保持向后兼容：`(name, label, type?, value?, opts?)`。
 * 新增 opts 都是可选，缺失时与原行为一致。
 */

import { escapeHtml } from './html.js';

export function formField(name, label, type = 'text', value = '', opts = {}) {
  const esc = escapeHtml;
  const densityClass = opts.density === 'compact'
    ? ' compact'
    : opts.density === 'spacious'
    ? ' spacious'
    : '';
  const errorClass = opts.error ? ' field-error' : '';
  const attrs = `name="${esc(name)}" id="field-${esc(name)}" ${opts.required === false ? '' : 'required'} ${
    opts.max !== undefined ? `max="${opts.max}"` : ''
  } ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.step ? `step="${opts.step}"` : ''}`;
  const content =
    type === 'textarea'
      ? `<textarea ${attrs} maxlength="${opts.maxlength || 2000}" rows="4">${esc(value)}</textarea>`
      : type === 'select'
      ? `<select ${attrs}>${(opts.options || [])
          .map((o) => {
            const [v, l] = Array.isArray(o) ? o : [o, opts.optionLabel ? opts.optionLabel(o) : o];
            return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
          })
          .join('')}</select>`
      : type === 'checkbox'
      ? `<input type="checkbox" name="${esc(name)}" id="field-${esc(name)}" ${value ? 'checked' : ''}>`
      : `<input type="${esc(type)}" ${attrs} value="${esc(value)}" maxlength="${opts.maxlength || 200}" ${
          type === 'password' ? 'autocomplete="new-password"' : ''
        }>`;
  const helpers =
    (opts.helper ? `<p class="form-helper">${esc(opts.helper)}</p>` : '') +
    (opts.error ? `<p class="form-error">${esc(opts.error)}</p>` : '');
  return `<label class="field ${type === 'textarea' ? 'wide' : ''} ${type === 'checkbox' ? 'check' : ''}${densityClass}${errorClass}"><span>${esc(
    label
  )}</span>${content}${helpers}</label>`;
}