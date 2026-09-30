/**
 * 共享弹窗原语。
 *
 * 用原生 <dialog>.showModal()，自带焦点陷阱和 Esc 关闭。
 * 输出的 HTML 逐字固定，有测试直接断言。
 *
 * opts.footer 是 v82 加的：在按钮区追加自定义内容，位置在主提交按钮之前。
 * 旧签名保持向后兼容。
 *
 * 「正在保存」这道闸门别去掉：提交过程中会把所有关闭按钮禁用、
 * 并拦掉 Esc 和点遮罩，否则用户能在请求还在飞的时候把弹窗关掉，
 * 回调就落在了已经脱离文档的节点上。
 */

export function openDialog(deps, title, content, { submit, label, wide = false, footer = '' } = {}) {
  const { $, $$, esc } = deps;
  label = label || '存下';

  // 同时只允许一个弹窗
  $('#modal')?.close();
  $('#modal')?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = 'modal';
  dialog.className = wide ? 'modal wide-modal' : 'modal';
  dialog.innerHTML =
    `<div class="modal-head"><h2>${esc(title)}</h2>` +
    `<button type="button" class="icon-button" data-close aria-label="${'关闭'}">✕</button></div>` +
    `<form class="modal-body"><div class="form-grid">${content}</div>` +
    `<p class="form-error" role="alert"></p>` +
    `<div class="actions">${footer}<button type="button" data-close>${'取消'}</button>` +
    `${submit ? `<button class="primary" type="submit">${esc(label)}</button>` : ''}</div></form>`;

  // 记下打开前的焦点，关闭时还回去（键盘用户否则会从头开始 Tab）
  const previous = document.activeElement;
  document.body.append(dialog);

  const close = () => {
    if (dialog.dataset.saving !== 'true') dialog.close();
  };

  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.saving === 'true') event.preventDefault();
  });

  $$('[data-close]', dialog).forEach((b) => (b.onclick = close));

  // 点弹窗外的遮罩关闭。原生 dialog 的事件目标是 dialog 自己，
  // 但点在 padding 上也算，所以要再按坐标排除弹窗本体那一块。
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });

  dialog.addEventListener('close', () => {
    dialog.remove();
    previous?.focus();
  }, { once: true });

  if (submit) {
    $('form', dialog).onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = $('[type=submit]', form);
      if (btn.disabled) return;

      const data = Object.fromEntries(new FormData(form));
      // FormData 拿勾选框只有「勾了才出现」，数字框空值会是空串。
      // 这两类得手工补齐，不然后端收到 undefined 或 ''。
      $$('input[type=checkbox]:not(:disabled)', form).forEach(
        (c) => (data[c.name] = c.checked ? 1 : 0)
      );
      $$('input[type=number]:not(:disabled)', form).forEach(
        (c) => (data[c.name] = c.value === '' ? null : Number(c.value))
      );

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
  }

  dialog.showModal();
  $('input:not([type=checkbox]),textarea,select', dialog)?.focus();
  return dialog;
}
