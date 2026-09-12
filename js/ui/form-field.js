import {escapeHtml} from './html.js';
export function formField(name,label,type='text',value='',opts={
}
) {
  const esc=escapeHtml;
  const attrs=`name="${esc(name)}" id="field-${esc(name)}" ${opts.required===false?'':'required'} ${opts.max!==undefined?`max="${opts.max}"`:''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.step?`step="${opts.step}"`:''}`;
  const content=type==='textarea'?`<textarea ${attrs} maxlength="${opts.maxlength||2000}" rows="4">${esc(value)}</textarea>`:type==='select'?`<select ${attrs}>${(opts.options||[]).map(o=>{
    const [v,l]=Array.isArray(o)?o:[o,opts.optionLabel?opts.optionLabel(o):o];return `<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`;
  }
  ).join('')}</select>`:type==='checkbox'?`<input type="checkbox" name="${esc(name)}" id="field-${esc(name)}" ${value?'checked':''}>`:`<input type="${esc(type)}" ${attrs} value="${esc(value)}" maxlength="${opts.maxlength||200}" ${type==='password'?'autocomplete="new-password"':''}>`;
  return `<label class="field ${type==='textarea'?'wide':''} ${type==='checkbox'?'check':''}"><span>${esc(label)}</span>${content}</label>`;
}
