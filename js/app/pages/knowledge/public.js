/**
 * 灯光市知识库（公开查询页）。
 *
 * 原来这个文件只有 7 行、最长行 1048 字符：页头、搜索框、结果列表、兜底文案
 * 全在一根模板串里。现在拆成「外壳模板 / 搜索结果模板 / 两个入口」。
 *
 * 不能改的行为：
 *   1. 页面底部那句「找灯灯转人工」和空结果时的「知识库里还没有核对过的答案」
 *      是两处不同文案，别合并成一句。空结果用的是 `<p class="notice">`，不是
 *      core 的 empty() —— 两者 DOM 结构不同，CSS 依赖它。
 *   2. 带 `?id=` 直达时不读输入框，直接按 id 查。这一条是给外部链接用的
 *      （灯灯答复里会带知识库链接），不能要求用户先点一次「查一查」。
 *   3. 每次搜索都走 region()，所以重复点同一个词会有 loading 骨架。
 *      切走页面后 region 内部会自己判 isConnected，不用额外加守卫。
 */

import { $, api, field, action, esc, text, region } from '../../core.js';

/** 页头 + 搜索框 + 结果槽 + 人工兜底入口 */
const PAGE_MARKUP =
  '<h1>灯光市知识库</h1>' +
  '<p>只收录核对过、且原始资料没改过的答案。这里查不到的，交给灯灯转人工，别自己猜。</p>' +
  '<div class="toolbar">' +
  field('q', '想问点啥', 'text', '', { required: false, maxlength: 500 }) +
  '<button id="knowledge-search">查一查</button></div>' +
  '<div id="knowledge-results"></div>' +
  '<a class="button" href="/dm.html">找灯灯转人工</a>';

/** 一条已核对的知识 */
function articleMarkup(a) {
  return (
    '<article class="panel">' +
    `<h2>#${a.id} ${esc(a.title)}</h2>` +
    `<p>${text(a.question)}</p>` +
    `<p>${text(a.answer)}</p>` +
    `<small>已核对 · v${a.revision}</small></article>`
  );
}

export async function render(el) {
  el.innerHTML = PAGE_MARKUP;

  /** 按查询串（`q=…` 或 `id=…`）查一次并画结果 */
  const load = (query) =>
    region($('#knowledge-results', el), () => api('/api/knowledge?' + query), (d, box) => {
      box.innerHTML =
        d.articles.map(articleMarkup).join('') ||
        '<p class="notice">知识库里还没有核对过的答案，这题得找人工问。</p>';
    });

  $('#knowledge-search', el).onclick = (e) =>
    action(e.currentTarget, () => load('q=' + encodeURIComponent($('[name=q]', el).value)));

  // 从别处带 id 进来（比如灯灯答复里的链接）时直接查，不经过输入框
  const id = new URLSearchParams(location.search).get('id');
  if (id) await load('id=' + encodeURIComponent(id));
}
