// v50: 通用 UI 绑定 — lightbox / 通用 form modal / login modal
import { $, esc, fmt, safeRender } from './util.js?v=20260905-v50-0';

// ============ Lightbox ============
let _lbImages = [];
let _lbIndex = 0;
export function bindLightbox() {
  const lb = $('#lightbox');
  if (!lb) return;
  $('#lbClose')?.addEventListener('click', closeLb);
  $('#lbPrev')?.addEventListener('click', () => navLb(-1));
  $('#lbNext')?.addEventListener('click', () => navLb(1));
  document.addEventListener('keydown', e => {
    if (lb.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') navLb(-1);
      else if (e.key === 'ArrowRight') navLb(1);
    }
  });
  lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
}
export function openLightbox(images, startIdx = 0) {
  _lbImages = images;
  _lbIndex = startIdx;
  renderLb();
  const lb = $('#lightbox');
  if (lb) { lb.setAttribute('aria-hidden', 'false'); lb.style.display = 'flex'; }
  document.body.style.overflow = 'hidden';
}
function closeLb() {
  const lb = $('#lightbox');
  if (lb) { lb.setAttribute('aria-hidden', 'true'); lb.style.display = 'none'; }
  document.body.style.overflow = '';
}
function navLb(delta) {
  if (!_lbImages.length) return;
  _lbIndex = (_lbIndex + delta + _lbImages.length) % _lbImages.length;
  renderLb();
}
function renderLb() {
  const img = _lbImages[_lbIndex];
  if (!img) return;
  $('#lbImg').src = img.url;
  $('#lbImg').alt = img.title || '';
  $('#lbCap').textContent = img.title || '';
}

// ============ 通用 form modal ============
const FORM_TPL = {
  kartSignup: {
    title: '🏁 试跑报名',
    summary: '🏎️ 灯光市国际赛车场（拟建）',
    fields: [
      { type: 'text', name: 'name', label: '游戏 ID', required: true, placeholder: '你的游戏 ID' },
      { type: 'text', name: 'contact', label: '联系方式', required: true, placeholder: '邮箱 / 游戏内编号' },
      { type: 'select', name: 'session', label: '期望场次', options: ['周六 14:00 计时赛', '周六 20:00 接力赛', '周日 10:00 教学场', '其他时间'] },
      { type: 'number', name: 'car', label: '车号偏好 (1-99)', min: 1, max: 99, placeholder: '留空随机分配' },
      { type: 'textarea', name: 'note', label: '备注（选填）', rows: 2, placeholder: '是否需要教学、组队信息等' },
    ],
  },
  license: {
    title: '📝 驾照考试报名',
    summary: '考试由市政厅组织',
    fields: [
      { type: 'select', name: 'grade', label: '驾照等级', options: ['B 级（初级）', 'A 级（中级）', 'S 级（高级 / 职业）'] },
      { type: 'date', name: 'date', label: '考试日期（选填）' },
      { type: 'select', name: 'session', label: '期望场次（选填）', options: ['周六 14:00', '周六 20:00', '周日 10:00', '工作日 19:00'] },
      { type: 'text', name: 'contact', label: '联系方式', required: true, placeholder: '邮箱 / 游戏内编号' },
      { type: 'textarea', name: 'note', label: '备注（选填）', rows: 2, placeholder: '需要教学、组队等' },
    ],
  },
  hotelBook: {
    title: '🏨 预订房间',
    summary: '树上酒店房型',
    fields: [
      { type: 'date', name: 'checkin', label: '入住日期', required: true },
      { type: 'date', name: 'checkout', label: '退房日期', required: true },
      { type: 'number', name: 'guests', label: '入住人数', min: 1, max: 10, required: true },
      { type: 'text', name: 'contact', label: '联系方式', required: true, placeholder: '邮箱 / 游戏内编号' },
      { type: 'textarea', name: 'note', label: '备注（选填）', rows: 2 },
    ],
  },
};

export function bindGenericForm() {
  const mask = $('#formMask');
  if (!mask) return;
  $('#formClose')?.addEventListener('click', () => closeForm());
  mask.addEventListener('click', e => { if (e.target === mask) closeForm(); });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open-form]');
    if (!t) return;
    e.preventDefault();
    openForm(t.dataset.openForm);
  });
  // ESC 关闭
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mask.style.display !== 'none') closeForm();
  });
  window._openGenericForm = (kind) => openForm(kind);
}
function openForm(kind) {
  const tpl = FORM_TPL[kind];
  if (!tpl) { console.warn('Unknown form kind:', kind); return; }
  const mask = $('#formMask');
  const form = $('#formBody');
  $('#formTitle').textContent = tpl.title;
  form.innerHTML = `<div class="book-room-summary"><div><b>${esc(tpl.summary)}</b><br/><span class="book-sub">提交后由市政厅审核</span></div><div class="summary-price">免费</div></div>` +
    tpl.fields.map(f => renderField(f)).join('') +
    `<div class="modal-msg" id="formMsg"></div>
     <div class="modal-actions">
       <button type="button" class="btn btn-ghost" id="formCancel">取消</button>
       <button type="submit" class="btn btn-primary">▶ 提交</button>
     </div>`;
  form.dataset.kind = kind;
  $('#formCancel')?.addEventListener('click', closeForm);
  mask.style.display = '';
  document.body.style.overflow = 'hidden';
  setTimeout(() => form.querySelector('input, select, textarea')?.focus(), 50);
}
function renderField(f) {
  const id = 'f_' + f.name;
  let input = '';
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.name}"${f.required ? ' required' : ''}>` +
      f.options.map(o => `<option>${esc(o)}</option>`).join('') + '</select>';
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}"></textarea>`;
  } else {
    input = `<input type="${f.type}" id="${id}" name="${f.name}"${f.required ? ' required' : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} placeholder="${esc(f.placeholder || '')}" />`;
  }
  return `<label class="full"><span>${esc(f.label)}</span>${input}</label>`;
}
function closeForm() {
  const mask = $('#formMask');
  if (mask) mask.style.display = 'none';
  document.body.style.overflow = '';
}

// ============ Login modal (moved out of auth.js) ============
export function bindLogin() {
  // 这里只挂 mask close / esc, 实际 open 由 auth.js 控制
  const mask = $('#loginMask');
  if (!mask) return;
  const close = () => { mask.style.display = 'none'; document.body.style.overflow = ''; };
  $('#loginClose')?.addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mask.style.display !== 'none') close();
  });
}
