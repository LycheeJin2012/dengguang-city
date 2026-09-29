/**
 * Shared dialog primitive.
 *
 * v82 起新增 opts.footer：在 actions 区追加自定义按钮或 HTML（位于主提交按钮之前）。
 * 旧签名保持向后兼容。
 */

export function openDialog(
  deps,
  title,
  content,
  { submit, label, wide = false, footer = '' } = {}
) {
  const { $, $$, esc } = deps;
  label = label || '存下';
  $('#modal')?.close();
  $('#modal')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'modal';
  dialog.className = wide ? 'modal wide-modal' : 'modal';
  dialog.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="${'关闭'}">✕</button></div><form class="modal-body"><div class="form-grid">${content}</div><p class="form-error" role="alert"></p><div class="actions">${footer}<button type="button" data-close>${'取消'}</button>${submit ? `<button class="primary" type="submit">${esc(label)}</button>` : ''}</div></form>`;
  const previous = document.activeElement;
  document.body.append(dialog);
  const close = () => {
    if (dialog.dataset.saving !== 'true') dialog.close();
  };
  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.saving === 'true') event.preventDefault();
  });
  $$('[data-close]', dialog).forEach((b) => (b.onclick = close));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close();
    }
  });
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      previous?.focus();
    },
    { once: true }
  );
  if (submit)
    $('form', dialog).onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = $('[type=submit]', form);
      if (btn.disabled) return;
      const data = Object.fromEntries(new FormData(form));
      $$('input[type=checkbox]:not(:disabled)', form).forEach((c) => (data[c.name] = c.checked ? 1 : 0));
      $$('input[type=number]:not(:disabled)', form).forEach((c) => (data[c.name] = c.value === '' ? null : Number(c.value)));
      const old = btn.textContent;
      btn.disabled = true;
      dialog.dataset.saving = 'true';
      $$('[data-close]', dialog).forEach((b) => (b.disabled = true));
      btn.textContent = '保存中…';
      $('.form-error', dialog).textContent = '';
      try {
        await submit(data, dialog);
        dialog.close();
      } catch (err) {
        $('.form-error', dialog).textContent = err.message;
      } finally {
        dialog.dataset.saving = 'false';
        $$('[data-close]', dialog).forEach((b) => (b.disabled = false));
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = old;
        }
      }
    };
  dialog.showModal();
  $('input:not([type=checkbox]),textarea,select', dialog)?.focus();
  return dialog;
}