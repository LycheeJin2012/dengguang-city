// v25.17: /api/manage-view — 简单的 manage data 展示页 (不用 admin UI 复杂逻辑)
// 用 window.__manageData 注入数据, 一个简单的表格展示
export async function onRequestGet(context) {
  const { env } = context;
  let dataJson = '{"hotels":[],"rooms":[],"tracks":[],"licenseReq":[]}';
  try {
    const hotels = (await env.DB.prepare('SELECT * FROM hotels ORDER BY sort_order, id').all()).results || [];
    const rooms = (await env.DB.prepare('SELECT * FROM hotel_rooms ORDER BY hotel_id, sort_order, id').all()).results || [];
    const tracks = (await env.DB.prepare('SELECT * FROM race_tracks ORDER BY sort_order, id').all()).results || [];
    const licenseReq = (await env.DB.prepare('SELECT * FROM license_requirements ORDER BY sort_order, id').all()).results || [];
    dataJson = JSON.stringify({ hotels, rooms, tracks, licenseReq });
  } catch (e) {
    dataJson = JSON.stringify({ error: String(e.message) });
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Manage Data | 灯光市</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #fff8e7; margin: 0; padding: 20px; color: #2a1f10; }
  h1 { color: #5a2; border-bottom: 3px solid #fc6; padding-bottom: 8px; }
  h2 { color: #2a4; margin-top: 30px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; background: #fff; }
  th, td { border: 1px solid #d4c8a8; padding: 8px 12px; text-align: left; }
  th { background: #fc6; color: #2a1f10; font-weight: bold; }
  tr:nth-child(even) { background: #fdf6e3; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  .pill-yes { background: #5a8; color: white; }
  .pill-no { background: #c95; color: white; }
  .room-list { background: #efe9d8; padding: 8px; margin: 4px 0; border-left: 3px solid #5a2; }
  .desc { color: #666; font-size: 13px; }
</style>
</head>
<body>
<h1>🏛️ 灯光市 · Manage Data</h1>
<p>实时从 D1 数据库拉取。点下面 "添加" 按钮 (需 super 登录) 可新增数据。</p>

<h2>🏨 酒店 (<span id="hotelCount">0</span>)</h2>
<div id="hotels"></div>

<h2>🛏️ 房型 (<span id="roomCount">0</span>)</h2>
<div id="rooms"></div>

<h2>🏁 赛车场 (<span id="trackCount">0</span>)</h2>
<div id="tracks"></div>

<h2>🎫 驾照要求 (<span id="licenseCount">0</span>)</h2>
<div id="licenses"></div>

<script>
window.__manageData = ${dataJson};
const d = window.__manageData;

function fmt(v) { return v == null ? '—' : v; }
function esc(s) { return String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]); }

function renderHotels() {
  document.getElementById('hotelCount').textContent = d.hotels.length;
  const html = d.hotels.map(h => {
    const hrs = d.rooms.filter(r => r.hotel_id === h.id);
    return '<table>' +
      '<tr><th colspan="2">🏨 ' + esc(h.name) + ' <span class="pill ' + (h.is_active ? 'pill-yes' : 'pill-no') + '">' + (h.is_active ? '上架' : '下架') + '</span></th></tr>' +
      '<tr><td width="100">地址</td><td>' + esc(fmt(h.address)) + '</td></tr>' +
      '<tr><td>介绍</td><td><div class="desc">' + esc(fmt(h.description)) + '</div></td></tr>' +
      '<tr><td>排序</td><td>' + esc(h.sort_order) + '</td></tr>' +
      (hrs.length > 0 ? '<tr><td>房型</td><td>' + hrs.map(r =>
        '<div class="room-list">' +
        '🛏️ <b>' + esc(r.name) + '</b> · ' + r.capacity + '人 · ' + (r.breakfast_included ? '🍳含早餐' : '—') +
        ' · <b style="color:#2a8">💎 ' + r.price_per_night + '/晚</b> · ' + esc(fmt(r.beds)) +
        (r.description ? '<div class="desc">' + esc(r.description) + '</div>' : '') +
        '</div>'
      ).join('') + '</td></tr>' : '') +
      '</table>';
  }).join('') || '<p style="color:#999">暂无酒店</p>';
  document.getElementById('hotels').innerHTML = html;
}

function renderRooms() {
  document.getElementById('roomCount').textContent = d.rooms.length;
  const html = '<table><tr><th>ID</th><th>酒店</th><th>房型名</th><th>人数</th><th>床</th><th>💎/晚</th><th>早餐</th><th>描述</th></tr>' +
    d.rooms.map(r => {
      const hotel = d.hotels.find(h => h.id === r.hotel_id);
      return '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td>' + esc(hotel ? hotel.name : '?') + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + r.capacity + '</td>' +
        '<td>' + esc(fmt(r.beds)) + '</td>' +
        '<td><b style="color:#2a8">' + r.price_per_night + '</b></td>' +
        '<td>' + (r.breakfast_included ? '🍳' : '—') + '</td>' +
        '<td><div class="desc">' + esc(fmt(r.description)) + '</div></td>' +
        '</tr>';
    }).join('') +
    '</table>';
  document.getElementById('rooms').innerHTML = d.rooms.length ? html : '<p style="color:#999">暂无房型</p>';
}

function renderTracks() {
  document.getElementById('trackCount').textContent = d.tracks.length;
  const html = '<table><tr><th>ID</th><th>名称</th><th>长度</th><th>圈数</th><th>难度</th><th>介绍</th></tr>' +
    d.tracks.map(t =>
      '<tr><td>' + t.id + '</td><td>' + esc(t.name) + '</td><td>' + (t.length_km || '?') + ' km</td><td>' + (t.laps || '?') + '</td><td>' + esc(fmt(t.difficulty)) + '</td><td><div class="desc">' + esc(fmt(t.description)) + '</div></td></tr>'
    ).join('') +
    '</table>';
  document.getElementById('tracks').innerHTML = d.tracks.length ? html : '<p style="color:#999">暂无赛车场</p>';
}

function renderLicenses() {
  document.getElementById('licenseCount').textContent = d.licenseReq.length;
  const html = '<table><tr><th>类型</th><th>标题</th><th>介绍</th><th>要求</th><th>年龄</th><th>时长</th></tr>' +
    d.licenseReq.map(l =>
      '<tr><td><b>' + esc(l.exam_type) + ' 级</b></td><td>' + esc(l.title) + '</td><td><div class="desc">' + esc(fmt(l.description)) + '</div></td><td><div class="desc" style="white-space:pre-wrap">' + esc(fmt(l.requirements)) + '</div></td><td>' + l.min_age + '+</td><td>' + l.duration_minutes + ' 分钟</td></tr>'
    ).join('') +
    '</table>';
  document.getElementById('licenses').innerHTML = d.licenseReq.length ? html : '<p style="color:#999">暂无驾照要求</p>';
}

renderHotels();
renderRooms();
renderTracks();
renderLicenses();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
}
