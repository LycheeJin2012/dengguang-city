// v47: 市民身份卡生成器 (纯前端 SVG, 不依赖后端)
// 风格: 像素风卡片, 含玩家信息/绿宝石/驾照等级/签到天数/通行密钥
import { $, esc } from '../util.js?v=v46-fix-modules';

let _meCache = null;

async function getMe() {
  if (_meCache) return _meCache;
  try {
    const d = await fetch('/api/login', { credentials: 'include' }).then(r => r.json());
    if (d && d.ok && d.player) {
      _meCache = d.player;
      return _meCache;
    }
  } catch (e) { /* 静默 */ }
  return null;
}

export function bindCitizenCard() {
  const btn = $('#genCardBtn');
  if (!btn) return;
  btn.addEventListener('click', generateCard);
}

async function generateCard() {
  const me = await getMe();
  if (!me) { if (window._toast) window._toast('请先登录', 'error'); return; }
  const preview = $('#citizenCardPreview');
  const svg = renderCardSvg(me);
  preview.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:0 0 360px;max-width:100%">${svg}</div>
      <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px">
        <p style="margin:0;font-size:13px;color:var(--c-stone-dark)">右键下方"下载"按钮保存为 SVG 文件 (可粘贴到 MC 群或转 PNG)。</p>
        <button id="dlCardBtn" class="btn btn-primary">⬇️ 下载 SVG</button>
        <button id="copyCardBtn" class="btn btn-ghost">📋 复制 SVG 源码</button>
      </div>
    </div>
  `;
  // 实际插入的 svg 是 string, 取出来当 DOM
  preview.querySelector('#dlCardBtn')?.addEventListener('click', () => downloadSvg(svg, me.username + '_citizen_card.svg'));
  preview.querySelector('#copyCardBtn')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(svg); if (window._toast) window._toast('已复制', 'success'); }
    catch (e) { if (window._toast) window._toast('复制失败: ' + e.message, 'error'); }
  });
}

function renderCardSvg(p) {
  const username = p.username || '市民';
  const avatar = p.avatar_emoji || '👤';
  const emeralds = p.emeralds || 0;
  const id = p.id || 0;
  const created = (p.created_at || '').slice(0, 10);
  const yearOfService = created ? (new Date().getFullYear() - new Date(created).getFullYear()) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220" width="360" height="220" style="font-family:monospace">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5d7c15"/>
      <stop offset="100%" stop-color="#3a5a0a"/>
    </linearGradient>
    <pattern id="grid" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#4a6a0f" stroke-width="0.5"/>
    </pattern>
  </defs>
  <!-- 背景 -->
  <rect width="360" height="220" fill="url(#bg)"/>
  <rect width="360" height="220" fill="url(#grid)"/>
  <!-- 边框 -->
  <rect x="4" y="4" width="352" height="212" fill="none" stroke="#ffaa00" stroke-width="3"/>
  <rect x="10" y="10" width="340" height="200" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 2"/>
  <!-- 顶部金条 -->
  <rect x="10" y="10" width="340" height="22" fill="#ffaa00" stroke="#000" stroke-width="2"/>
  <text x="180" y="26" text-anchor="middle" font-size="12" font-weight="bold" fill="#000" letter-spacing="2">🎮 灯光市 · 市民卡</text>
  <!-- 头像 -->
  <rect x="20" y="44" width="60" height="60" fill="#f7f0d8" stroke="#000" stroke-width="3"/>
  <text x="50" y="86" text-anchor="middle" font-size="40">${esc(avatar)}</text>
  <!-- 名字 -->
  <text x="92" y="64" font-size="16" font-weight="bold" fill="#fff">${esc(username)}</text>
  <text x="92" y="82" font-size="10" fill="#ffaa00">#${String(id).padStart(4, '0')}</text>
  <text x="92" y="98" font-size="9" fill="#fff">入驻: ${esc(created || '—')}</text>
  <!-- 数据 -->
  <g transform="translate(20, 120)">
    <rect width="320" height="80" fill="#1a2a0a" stroke="#ffaa00" stroke-width="2"/>
    <text x="10" y="20" font-size="10" fill="#ffaa00" font-weight="bold">💎 绿宝石</text>
    <text x="10" y="40" font-size="20" font-weight="bold" fill="#fff">${emeralds}</text>
    <text x="110" y="20" font-size="10" fill="#ffaa00" font-weight="bold">📅 服务年数</text>
    <text x="110" y="40" font-size="20" font-weight="bold" fill="#fff">${yearOfService}</text>
    <text x="210" y="20" font-size="10" fill="#ffaa00" font-weight="bold">🎫 身份</text>
    <text x="210" y="40" font-size="14" font-weight="bold" fill="#fff">${esc(p.status || 'active')}</text>
    <text x="10" y="70" font-size="9" fill="#9f9">dengguang-city.pages.dev</text>
  </g>
  <!-- 像素装饰 -->
  <rect x="330" y="40" width="14" height="14" fill="#ffaa00"/>
  <rect x="334" y="44" width="6" height="6" fill="#fff"/>
</svg>`;
}

function downloadSvg(svgStr, filename) {
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
