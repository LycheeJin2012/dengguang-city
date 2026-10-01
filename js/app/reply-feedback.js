import {$,$$,post,esc,action} from './core.js';

// 下面这段 HTML 用反斜杠续行拆成多行，纯粹为了让人能一眼看完骨架。
// 两条规矩，改之前先看清楚：
//   1. 续行**不能缩进**。反斜杠续行只吃掉换行本身，下一行的行首空白会原样进 HTML。
//   2. 只能在元素边界断行，也就是「> 后面紧跟 < 」的地方。断在标签中间，
//      比如把 <span> 和它后面的文字分开，读起来反而更难。
// 输出必须与压缩版逐字节相同 —— tests/feedback-security-equiv.test.js 拿 192 组
// kind × id × helpful 两版实跑逐字节比对，那条测试就是这两条规矩的守门。

/** 一次回答的「有没有用」投票块。id 为空时不渲染。 */
export function feedbackMarkup(kind, id, helpful = null) {
  if (!id) return '';
  return `<div class="reply-feedback" data-feedback-kind="${kind}" data-feedback-id="${Number(id)}">\
<span>这个回答有用吗？</span>\
<div class="actions">\
<button type="button" data-vote="yes" aria-pressed="${helpful===1}">👍 有用</button>\
<button type="button" data-vote="no" aria-pressed="${helpful===0}">👎 没有解决</button>\
</div>\
<div data-feedback-reason hidden>\
<label>哪里需要改进？<select>\
<option value="not_resolved">没有解决问题</option>\
<option value="irrelevant">答非所问</option>\
<option value="incorrect">内容有误</option>\
<option value="other">其他</option>\
</select>\
</label>\
<label>补充说明（选填）<textarea maxlength="500" rows="2">\
</textarea>\
</label>\
<button type="button" data-feedback-send>提交反馈</button>\
</div>\
<p role="status" data-feedback-result>${helpful===null||helpful===undefined?'':'已记录你的评价，可修改。'}</p>\
</div>`;
}

/**
 * 给 root 下每个反馈块接上交互。
 *
 * data-bound 标记保证同一个块重复调用时不会绑第二遍 —— 列表重渲染会再调一次。
 * 提交成功后把两个投票按钮的 aria-pressed 收敛到刚选的那一个，用户可以改主意。
 */
export function bindFeedback(root) {
  $$('[data-feedback-kind]', root).forEach(box => {
    if (box.dataset.bound) return;
    box.dataset.bound = '1';

    const send = async helpful => {
      await post('/api/reply-feedback', {
        kind: box.dataset.feedbackKind,
        target_id: Number(box.dataset.feedbackId),
        helpful,
        reason: helpful ? '' : $('select', box).value,
        comment: helpful ? '' : $('textarea', box).value,
      });
      $('[data-feedback-result]', box).textContent = '反馈已记录，感谢你的意见。';
      $('[data-feedback-reason]', box).hidden = true;
      $$('[data-vote]', box).forEach(b => b.setAttribute('aria-pressed', (b.dataset.vote === 'yes') === helpful));
    };

    // 「有用」直接提交；「没有解决」先展开理由区，不发请求。
    $('[data-vote=yes]', box).onclick = e => action(e.currentTarget, () => send(true));
    $('[data-vote=no]', box).onclick = () => {
      $('[data-feedback-reason]', box).hidden = false;
    };
    $('[data-feedback-send]', box).onclick = e => action(e.currentTarget, () => send(false));
  });
}
