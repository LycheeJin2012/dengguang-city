/**
 * 发消息的输入区。
 *
 * 发完消息要做四件事才算完：清空输入框、把这轮新消息画出来、
 * 如果对方是灯灯还要同步刷客服面板、最后把会话标成已读并更新左侧列表。
 * 少做一件就会出现「发出去看着没反应」或者「左侧红点不消」。
 */

import { $, field, action, toast } from '../../core.js';

export function composerMarkup() {
  return (
    `<form id="send-form">` +
    field('content', '消息内容', 'textarea') +
    `<div class="actions"><button class="primary">发送 ↗</button></div></form>` +
    `<p role="status" id="chat-refresh-state"></p>`
  );
}

/**
 * 挂上提交处理。
 * @param {(content:string)=>Promise<{support_error?:boolean}>} send 真正发消息
 * @param {() => boolean} isCurrent  回合没被换掉（epoch 还是自己）
 */
export function bindComposer(box, send, isCurrent) {
  $('#send-form', box).onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    action($('button', form), async () => {
      const result = await send($('[name=content]', form).value);
      // 回合已经被换掉就别清空 —— 用户可能已经切到别的会话开始打字了
      if (isCurrent()) $('[name=content]', form).value = '';
      if (result?.support_error) {
        toast('消息已保存，但自动转人工暂未成功，请点击“转人工”重试', true);
      }
    });
  };
}
