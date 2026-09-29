/**
 * Map page workspace (public + admin views).
 *
 * v79-5 拆分自原 js/app/city-map.js（20 行 minified）。
 * 公共页 / 管理页 共用 mapView()，通过 manage 参数区分。
 */

import { viewAudit } from '../../audit-ui.js';
import {$,$$,api,post,esc,text,date,empty,title,field,modal,action,toast} from '../../core.js'

const categories = [
  ['facility', '公共设施'],
  ['hotel', '旅店'],
  ['rail', '铁路车站'],
  ['road', '道路'],
  ['park', '绿化'],
];

const states = [
  ['open', '正常开放'],
  ['planned', '即将开工'],
  ['construction', '正在开挖'],
  ['closed', '暂时关闭'],
];

const label = (list, key) => list.find((r) => r[0] === key)?.[1] || key;

export async function render(el) {
  return mapView(el, false);
}

export async function renderMapAdmin(el) {
  return mapView(el, true);
}

async function mapView(el, manage) {
  el.innerHTML =
    (manage
      ? '<div class="section-head"><h2>' + '地图与施工' + '</h2></div>'
      : title('城市地图与施工')) +
    `<section class="panel"><p>${
      manage
        ? '真实地点由超管维护。先存草稿，坐标和说明核对无误再发布；开工和恢复的进展直接写回这条地点。'
        : '这里是主世界坐标示意图，不是实时地形。谁在刨、刨多深、什么时候填平，看下面每条地点的施工说明。'
    }</p><div class="toolbar">${field('q', '搜地点', 'search', '', {
      required: false,
    })}${field('category', '分类', 'select', '', {
      required: false,
      options: [['', '全部分类'], ...categories],
    })}${field('work', '施工', 'select', '', {
      required: false,
      options: [['', '全部状态'], ...states],
    })}<button id="map-refresh">重新载入</button>${
      manage ? '<button id="map-add" class="primary">＋ 加地点</button>' : ''
    }</div></section><div class="map-layout"><section class="panel"><div id="map-plot" class="city-map" aria-label="地点坐标示意图"></div><p class="muted">上北下南，左西右东。图上的编号就是下面的地点，点编号就跳过去。</p></section><div id="map-list"></div></div>`;
  let places = [];
  function draw() {
    const q = $('[name=q]', el).value.trim().toLowerCase(),
      category = $('[name=category]', el).value,
      work = $('[name=work]', el).value;
    const rows = places.filter(
      (p) =>
        p.dimension === 'overworld' &&
        (!category || p.category === category) &&
        (!work || p.construction_status === work) &&
        (!q ||
          (p.name + ' ' + p.description + ' ' + p.construction_note)
            .toLowerCase()
            .includes(q))
    );
    const xs = rows.map((p) => p.x),
      zs = rows.map((p) => p.z),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs);
    /* v87：区分「压根没有地点」和「筛选后没匹配上」两种空。
       线上地图一条地点都没有，原先两处却同时显示「没找到符合条件的地点」和
       「这里还空着，等超管摆上第一个地点」—— 前者暗示用户筛错了，实际是数据
       为空，措辞误导；两个空状态叠在一起也重复。现在按 places 总数分流。 */
    const noPlacesAtAll = places.length === 0;
    $('#map-plot', el).innerHTML =
      rows.length
        ? rows
            .map(
              (p, i) =>
                `<button type="button" class="map-pin ${
                  p.construction_status === 'open' ? '' : 'map-work'
                }" style="left:${10 + 80 * (maxX === minX ? 0.5 : (p.x - minX) / (maxX - minX))}%;top:${10 +
                  80 *
                    (maxZ === minZ ? 0.5 : (p.z - minZ) / (maxZ - minZ))}%" data-pin="${
                  p.id
                }" aria-label="${esc(p.name)} · ${label(states, p.construction_status)}">${
                  i + 1
                }</button>`
            )
            .join('')
        : noPlacesAtAll
        ? ''
        : empty('没找到符合条件的地点');
    $('#map-list', el).innerHTML =
      rows
        .map(
          (p, i) =>
            `<article class="panel" id="place-${p.id}" tabindex="-1"><div class="row-head"><h2>${
              i + 1
            }. ${esc(p.name)}</h2><span class="badge">${label(
              states,
              p.construction_status
            )}${manage ? (p.published ? ' · 已发布' : ' · 草稿') : ''}</span></div><p>${label(
              categories,
              p.category
            )} · 主世界 · X ${p.x} / Z ${p.z}</p><p>${text(p.description)}</p>${
              p.construction_status !== 'open' || p.construction_note
                ? `<div class="notice"><b>施工与绕行</b><p>${text(
                    p.construction_note || '这条还没写施工说明'
                  )}</p>${
                    p.expected_end
                      ? `<p>预计 ${esc(p.expected_end)} 恢复（工期会变，以现场为准）</p>`
                      : ''
                  }</div>`
                : ''
            }<small>更新于 ${date(p.updated_at)}</small><div class="actions"><button data-copy="${
              p.id
            }">复制坐标</button>${
              manage
                ? `<button data-edit="${p.id}">编辑 / 发布 / 施工</button><button data-audit="${p.id}">操作留痕</button>`
                : ''
            }</div></article>`
        )
        .join('') ||
      (noPlacesAtAll
        ? empty('这里还空着，等超管摆上第一个地点')
        : empty('没找到符合条件的地点，换个筛选条件试试'));
    $$('[data-pin]', el).forEach((b) =>
      b.onclick = () => {
        const card = $('#place-' + b.dataset.pin, el);
        card.scrollIntoView({ block: 'start', behavior: 'auto' });
        card.focus({ preventScroll: true });
      }
    );
    $$('[data-copy]', el).forEach((b) =>
      b.onclick = (e) =>
        action(e.currentTarget, async () => {
          const p = places.find((p) => p.id === +b.dataset.copy);
          try {
            await navigator.clipboard.writeText(
              `${p.name} · 主世界 · X ${p.x} / Z ${p.z}`
            );
            toast('坐标已复制，去游戏里 /tp 吧');
          } catch {
            toast('复制没成功，手动从卡片上抄坐标', true);
          }
        })
    );
    $$('[data-edit]', el).forEach((b) =>
      b.onclick = () => edit(places.find((p) => p.id === +b.dataset.edit))
    );
    $$('[data-audit]', el).forEach((b) =>
      b.onclick = () =>
        viewAudit('city_places', b.dataset.audit).catch((e) => toast(e.message, true))
    );
  }
  async function load() {
    try {
      places = (await api('/api/city-map' + (manage ? '?manage=1' : ''))).places;
      draw();
    } catch (e) {
      $('#map-list', el).innerHTML = empty(e.message);
      toast(e.message, true);
    }
  }
  function edit(p = {}) {
    modal(
      p.id ? '改这条地点' : '加一个地点',
      field('name', '地点名', 'text', p.name || '', { maxlength: 80 }) +
        field('category', '分类', 'select', p.category || 'facility', { options: categories }) +
        field('x', 'X 坐标', 'number', p.x ?? 0) +
        field('z', 'Z 坐标', 'number', p.z ?? 0) +
        field('description', '这地方是干嘛的', 'textarea', p.description || '', {
          required: false,
          maxlength: 2000,
        }) +
        field('construction_status', '开没开工', 'select', p.construction_status || 'open', {
          options: states,
        }) +
        field('construction_note', '施工与绕行', 'textarea', p.construction_note || '', {
          required: false,
          maxlength: 1500,
        }) +
        field('expected_end', '预计恢复（可空）', 'date', p.expected_end || '', {
          required: false,
        }) +
        field('published', '上不上图', 'select', p.published ?? 0, {
          options: [
            [0, '草稿，先藏着'],
            [1, '挂到地图上'],
          ],
        }),
      {
        submit: async (values) => {
          await post('/api/city-map', {
            ...values,
            dimension: 'overworld',
            ...(p.id ? { id: p.id, revision: p.revision } : {}),
          });
          await load();
        },
      }
    );
  }
  $$('input,select', el).forEach((x) => x.addEventListener('input', draw));
  $('#map-refresh', el).onclick = load;
  if (manage) $('#map-add', el).onclick = () => edit();
  await load();
  const selected = places.find((p) => location.hash === '#place-' + p.id);
  if (selected) {
    draw();
    $('#place-' + selected.id, el)?.scrollIntoView({ block: 'start' });
  }
}