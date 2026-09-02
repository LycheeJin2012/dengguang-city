// v47: profile 赛道成绩卡 (上报 + 我的成绩 + 排行榜)
import { $, esc, GET, POST } from '../util.js?v=v46-fix-modules';

export async function renderRaceCard() {
  const card = $('#raceCard');
  const box = $('#raceContent');
  if (!card || !box) return;
  card.style.display = '';

  // 1. 我的成绩
  let mine = [];
  try {
    const d = await GET('/api/race-times?my=1');
    mine = d.times || [];
  } catch (e) { console.warn('[profile/race] load my failed', e); }

  // 2. 拉当前生效的赛道 (用 homepage-bundle 缓存的 tracks)
  let tracks = [];
  try {
    const d = await GET('/api/homepage-bundle');
    tracks = (d.bundle && d.bundle.tracks) || [];
    tracks = tracks.filter(t => t.is_active);
  } catch (e) { console.warn('[profile/race] load tracks failed', e); }

  box.innerHTML = `
    <div class="race-form">
      <h4 style="margin:0 0 8px 0">📤 上报新成绩</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <label style="flex:1;min-width:140px">赛道
          <select id="raceTrack" style="width:100%;padding:6px;border:2px solid var(--c-stone);font-family:inherit;background:var(--c-bg-1)">
            ${tracks.length ? tracks.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') : '<option value="">(暂无可用赛道)</option>'}
          </select>
        </label>
        <label style="flex:1;min-width:100px">用时 (mm:ss.fff)
          <input id="raceTime" placeholder="如 1:23.456" style="width:100%;padding:6px;border:2px solid var(--c-stone);font-family:inherit;background:var(--c-bg-1)" />
        </label>
        <label style="flex:1;min-width:100px">卡丁/车型
          <input id="raceKart" placeholder="如 MK4" style="width:100%;padding:6px;border:2px solid var(--c-stone);font-family:inherit;background:var(--c-bg-1)" />
        </label>
        <button id="raceSubmit" class="btn btn-primary">提交</button>
      </div>
      <p id="raceMsg" style="font-size:12px;color:var(--c-stone-dark);margin-top:6px"></p>
    </div>
    <h4 style="margin:16px 0 8px 0">📊 我的成绩 (${mine.length})</h4>
    <div class="race-mine">
      ${mine.length === 0 ? '<p class="muted">还没有成绩, 上报一个试试</p>' :
        `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:var(--c-bg-2)"><th>赛道</th><th>用时</th><th>车型</th><th>状态</th><th>日期</th></tr></thead>
          <tbody>${mine.slice(0, 10).map(r => `<tr style="border-top:1px solid var(--c-stone)">
            <td>${esc(r.track_name || ('#' + r.track_id))}</td>
            <td><b>${esc(r.formatted)}</b></td>
            <td>${esc(r.kart_name || '—')}</td>
            <td>${r.verified ? '<span style="color:var(--c-emerald)">✓ 已认证</span>' : '<span style="color:var(--c-gold)">⏳ 待认证</span>'}</td>
            <td>${esc((r.recorded_at || '').slice(0, 10))}</td>
          </tr>`).join('')}</tbody>
        </table>`}
    </div>
    <h4 style="margin:16px 0 8px 0">🏆 排行榜 (选赛道查看)</h4>
    <div id="raceLeaderboard">
      <select id="lbTrack" style="padding:6px;border:2px solid var(--c-stone);font-family:inherit;background:var(--c-bg-1)">
        ${tracks.length ? tracks.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') : '<option value="">(暂无可用赛道)</option>'}
      </select>
      <div id="lbList" style="margin-top:8px"><p class="muted">选赛道后查看</p></div>
    </div>
  `;

  // 绑定提交
  $('#raceSubmit')?.addEventListener('click', async () => {
    const trackId = parseInt($('#raceTrack')?.value || 0, 10);
    const timeStr = ($('#raceTime')?.value || '').trim();
    const kart = ($('#raceKart')?.value || '').trim();
    const msg = $('#raceMsg');
    const t = parseTimeStr(timeStr);
    if (!trackId) { msg.textContent = '请选择赛道'; return; }
    if (!t) { msg.textContent = '用时格式不对 (例 1:23.456 或 83.456 秒)'; return; }
    try {
      const r = await POST('/api/race-times', { track_id: trackId, time_ms: t, kart_name: kart });
      msg.style.color = 'var(--c-emerald)';
      msg.textContent = '✓ 已记录 ' + r.formatted + ', 等管理员确认后入榜';
      renderRaceCard();
    } catch (e) { msg.style.color = 'var(--c-redstone)'; msg.textContent = '✗ ' + e.message; }
  });

  // 绑定排行榜切换
  $('#lbTrack')?.addEventListener('change', async (e) => {
    const tid = parseInt(e.target.value || 0, 10);
    if (!tid) return;
    const lb = $('#lbList');
    lb.innerHTML = '<p class="muted">载入中…</p>';
    try {
      const d = await GET('/api/race-times?track_id=' + tid + '&limit=20');
      const list = d.leaderboard || [];
      if (!list.length) { lb.innerHTML = '<p class="muted">该赛道暂无认证成绩</p>'; return; }
      lb.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:var(--c-bg-2)"><th>#</th><th>玩家</th><th>用时</th><th>车型</th><th>驾照</th><th>日期</th></tr></thead>
        <tbody>${list.map(r => `<tr style="border-top:1px solid var(--c-stone)">
          <td>${r.rank <= 3 ? ['🥇','🥈','🥉'][r.rank-1] : r.rank}</td>
          <td>${esc(r.avatar_emoji || '👤')} ${esc(r.player_username || '玩家#'+r.player_id)}</td>
          <td><b>${esc(r.formatted)}</b></td>
          <td>${esc(r.kart_name || '—')}</td>
          <td>${esc(r.license_grade || '—')}</td>
          <td>${esc((r.recorded_at || '').slice(0, 10))}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    } catch (e) { lb.innerHTML = '<p style="color:var(--c-redstone)">✗ ' + e.message + '</p>'; }
  });
}

function parseTimeStr(s) {
  s = s.trim();
  if (!s) return 0;
  // 1:23.456 或 1:23
  if (s.includes(':')) {
    const m = s.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!m) return 0;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
    return (min * 60 + sec) * 1000 + ms;
  }
  // 83.456 (秒.毫秒)
  const f = parseFloat(s);
  if (isNaN(f)) return 0;
  return Math.round(f * 1000);
}
