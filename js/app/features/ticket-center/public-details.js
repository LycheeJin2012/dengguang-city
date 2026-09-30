/**
 * 公开工单详情 + 公开评论。
 *
 * 原来这是 features/ticket-center/index.js 末尾一整行（挂在这个模块外的一个
 * 自由函数），和 renderTicketCenter 的状态机挤在一起。它和工单墙的状态
 * （mode / rows / offset / epoch）完全无关，所以拆出来。
 *
 * 三个不能改的点：
 *   1. **公开单的正文用 text() 而不是 ticketBody()**。公开 API 返回的是后端
 *      脱敏过的纯文本（functions/ 里公开工单白名单不带结构化字段），
 *      按 JSON 解析只会走进 text() 的兜底。写成 ticketBody() 属于「看着更
 *      统一、实际改了行为」。
 *   2. **评论在弹窗打开时就加载，不等用户点开**。region() 负责 loading 态和
 *      失败重试按钮，这里不要自己再包一层 try/catch。
 *   3. **先 requirePlayer() 再 post**。未登录用户提交评论时弹登录，
 *      而不是让后端返回 401 变成一句干巴巴的表单错误。
 */

import { $, api, post, region, field, modal, requirePlayer, esc, text, date, status } from '../../core.js';
import { replyAuthor } from '../../ticket-form.js';

/** 弹窗主体：状态、正文、（若有）人工回复、评论区容器 */
function publicDetailsMarkup(ticket) {
  const reply = ticket.admin_reply
    ? `<div class="notice"><b>${esc(replyAuthor(ticket))}</b><p>${text(ticket.admin_reply)}</p></div>`
    : '';

  return (
    `<div class="wide">` +
    `<p>${status(ticket.status)}</p>` +
    `<p>${text(ticket.body)}</p>` +
    reply +
    `<h3>公开评论</h3>` +
    `<div id="public-comments"></div>` +
    `</div>` +
    field('content', '添加公开评论', 'textarea')
  );
}

/** 一条评论 */
function commentRow(c) {
  return `<div class="row"><b>${esc(c.author_name)}</b><p>${text(c.content)}</p><small>${date(c.created_at)}</small></div>`;
}

/**
 * 打开公开工单详情弹窗。
 * @param {string|number} id
 */
export async function publicDetails(id) {
  const { ticket } = await api('/api/tickets?public=1&id=' + encodeURIComponent(id));

  const dialog = modal(ticket.title, publicDetailsMarkup(ticket), {
    wide: true,
    label: '发表评论',
    submit: async (data) => {
      // 先确认登录：未登录时让 requirePlayer 弹登录框，而不是收一个 401
      await requirePlayer();
      await post('/api/ticket-comments', { ticket_id: id, content: data.content });
    },
  });

  // 评论在弹窗一开就取，region() 负责 loading / 失败重试
  await region(
    $('#public-comments', dialog),
    () => api('/api/ticket-comments?ticket_id=' + encodeURIComponent(id)),
    (d, box) => {
      box.innerHTML =
        d.comments.map(commentRow).join('') || `<p class="muted">暂无评论</p>`;
    }
  );
}
