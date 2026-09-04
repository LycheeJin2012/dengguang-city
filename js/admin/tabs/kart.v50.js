// v44 重写: 卡丁车 + 国际赛车场 tab (合并, 因为功能类似)
import { $, esc, fmt, GET, PATCH, DEL, safeRender, cacheClear } from '../core.v50.js?v=v50-fix';

const _KIND_LABEL = { kart: '🏁 赛道试跑', circuit: '🏎️ 国际赛车场' };

export async function renderKarts() {
  await safeRender(async () => renderKind('kart', 'kart'));
}
export async function renderCircuits() {
  await safeRender(async () => renderKind('circuit', 'circuit'));
}

async function renderKind(kind, prefix) {
  const url = kind === 'kart' ? '/api/admin/kart' : '/api/admin/circuit';
  const d = await GET(url);
  const list = d.signups || [];
  const cP = list.filter(x => x.status === 'pending').length;
  const cA = list.filter(x => x.status === 'approved').length;
  const cR = list.filter(x => x.status === 'rejected').length;
  $(`#${prefix}CntAll`).textContent = list.length;
  $(`#${prefix}CntPending`).textContent = cP;
  $(`#${prefix}CntApproved`).textContent = cA;
  $(`#${prefix}CntRejected`).textContent = cR;
  $(`#${prefix}Pending`).textContent = cP > 0 ? `(${cP})` : '';

  const filter = (document.querySelector(`input[name="${prefix}Filter"]:checked`) || {}).value || 'all';
  let shown = list;
  if (filter !== 'all') shown = shown.filter(x => x.status === filter);

  const box = $(`#${prefix}List`), empty = $(`#${prefix}Empty`);
  if (!shown.length) { box.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  box.innerHTML = shown.map(it => {
    const opts = ['pending', 'approved', 'rejected']
      .map(s => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${{ pending: '待审核', approved: '已批准', rejected: '已拒绝' }[s]}</option>`).join('');
    return `<article class="msg-item" data-id="${it.id}">
      <div class="msg-head"><div class="msg-head-left">
        <span class="msg-type type-book">${_KIND_LABEL[kind]}</span>
        <b class="msg-name">👤 ${esc(it.name)} · ${esc(it.contact)}</b>
        <span class="book-status">${esc(it.status)}</span>
        ${it.license ? `<span class="gallery-num" style="margin-left:4px">${esc(it.license)}</span>` : ''}
      </div><div class="msg-time">${fmt(it.created_at)}</div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--c-stone-dark);padding:4px 0">
        ${it.session ? `<span>🕒 ${esc(it.session)}</span>` : ''}
        ${it.car ? `<span>🏎️ ${esc(it.car)}</span>` : ''}
        ${it.emeralds_charged ? `<span>💎 ${it.emeralds_charged}</span>` : ''}
      </div>
      ${it.note ? `<p class="msg-content" style="font-size:13px;color:var(--c-stone-dark)">📝 ${esc(it.note)}</p>` : ''}
      <div class="msg-actions book-actions">
        <button class="btn btn-primary btn-sm" data-act="edit">✎ 编辑</button>
        <select class="${prefix}-status-sel">${opts}</select>
        <button class="btn btn-ghost btn-sm" data-act="save">保存状态</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </article>`;
  }).join('');

  box.querySelectorAll('.msg-item').forEach(el => {
    const id = +el.dataset.id;
    const it = shown.find(x => x.id === id);
    el.querySelector('[data-act="edit"]').onclick = () => kartCircuitEdit(it, kind);
    el.querySelector('[data-act="save"]').onclick = () => saveStatus(prefix, id, el.querySelector(`.${prefix}-status-sel`).value);
    el.querySelector('[data-act="del"]').onclick = () => delItem(prefix, id, kind);
  });
}

async function saveStatus(prefix, id, status) {
  try {
    const endpoint = prefix === 'kart' ? '/api/admin/kart' : '/api/admin/circuit';
    await PATCH(endpoint + '?id=' + id + '&status=' + status);
    cacheClear(prefix + ':');
    if (prefix === 'kart') renderKarts(); else renderCircuits();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}
async function delItem(prefix, id, kind) {
  if (!confirm('删除该报名？')) return;
  try {
    const endpoint = prefix === 'kart' ? '/api/admin/kart' : '/api/admin/circuit';
    await DEL(endpoint + '?id=' + id);
    cacheClear(prefix + ':');
    if (kind === 'kart') renderKarts(); else renderCircuits();
  } catch (e) { if (window._toast) window._toast('失败: ' + e.message, 'error'); }
}

export function kartCircuitEdit(it, kind) {
  let bd = document.getElementById('kcEditBackdrop');
  if (bd) bd.remove();
  bd = document.createElement('div');
  bd.id = 'kcEditBackdrop';
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  bd.innerHTML = `
    <div style="background:#fff;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:24px;max-width:520px;width:100%">
      <h3 style="margin:0 0 12px">✎ 编辑 ${_KIND_LABEL[kind]}</h3>
      <div style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>姓名</span><input id="kcName" type="text" value="${esc(it.name)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>联系方式</span><input id="kcContact" type="text" value="${esc(it.contact)}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>场次</span><input id="kcSession" type="text" value="${esc(it.session || '')}" style="padding:6px 8px;border:1px solid #888">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>车号 / 车型</span><input id="kcCar" type="text" value="${esc(it.car || '')}" style="padding:6px 8px;border:1px solid #888">
        </label>
        ${kind === 'circuit' ? `<label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>驾照</span><input id="kcLicense" type="text" value="${esc(it.license || '')}" style="padding:6px 8px;border:1px solid #888">
        </label>` : ''}
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px">
          <span>备注</span><textarea id="kcNote" rows="2" style="padding:6px 8px;border:1px solid #888">${esc(it.note || '')}</textarea>
        </label>
      </div>
      <div id="kcMsg" style="font-size:12px;margin-top:8px;min-height:18px;color:#c33"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="kcCancel" style="background:#888;color:#fff;border:none;padding:8px 16px;cursor:pointer">取消</button>
        <button id="kcSave" style="background:#6cf;color:#000;border:none;padding:8px 16px;cursor:pointer;font-weight:bold">保存</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  bd.querySelector('#kcCancel').onclick = close;
  bd.querySelector('#kcSave').onclick = async () => {
    try {
      const body = {
        name: bd.querySelector('#kcName').value.trim(),
        contact: bd.querySelector('#kcContact').value.trim(),
        session: bd.querySelector('#kcSession').value.trim(),
        car: bd.querySelector('#kcCar').value.trim(),
        note: bd.querySelector('#kcNote').value.trim(),
      };
      if (kind === 'circuit') body.license = bd.querySelector('#kcLicense').value.trim();
      const endpoint = kind === 'kart' ? '/api/admin/kart' : '/api/admin/circuit';
      await PATCH(endpoint + '?id=' + it.id, body);
      cacheClear(kind + ':');
      close();
      if (kind === 'kart') renderKarts(); else renderCircuits();
    } catch (e) { bd.querySelector('#kcMsg').textContent = '保存失败: ' + e.message; }
  };
}
