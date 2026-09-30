/**
 * 附件选择器：拖拽 / 点选 / 粘贴三种入口 + 单文件上传状态 + 失败重试。
 *
 * 原来整个 attachmentPicker 压在 js/app/attachments.js 的一行里：一个 900 字符的
 * innerHTML 模板、一个 draw()、一个 start()、一个 add()，四件事互相调用。
 * 现在按「壳 → 画列表 → 起一次上传 → 收一批文件」的顺序分开写。
 *
 * 这个控件要同时活在三种弹窗里（市民工单、后台工单、酒店宣传图），所以它只
 * 认 dialog，往 $('.form-grid') 里 append —— 不假设宿主是哪个页面。
 *
 * 五个不能改的行为：
 *   1. **提交按钮的禁用**跟着「有没有文件没传完」走（draw() 里算）。
 *      dialog.dataset.saving 是 js/ui/dialog.js 提交期间打的标记，必须一起看：
 *      否则上传途中点提交会出现「按钮亮了 → 一交就报还有文件没传完」。
 *   2. **进度回调只补那一行的 <progress>，不整表重画**。整表重画会把用户正在
 *      点的按钮/拖拽态冲掉，而且分片多时 innerHTML 会被刷到卡。
 *   3. **拿掉 ≠ 立刻 abort 完事**。item.removed 先置位，start() 的 finally 里
 *      才删服务端那条半成品 —— 否则 abort 让 uploadFile 抛错后，finally 又会把
 *      刚删掉的记录再建回来。
 *   4. **弹窗关闭时清场**：未 commit 的上传要删掉、preview 的 objectURL 要 revoke。
 *      committed 是「已经随工单发出去了」的标记，那种不能再删。
 *   5. **ids() 依赖 files() 的「都传完」检查**。用 this.files() 是为了让
 *      解构出来的 ids() 仍然成立（见文件末尾的返回对象）。
 */

import { $, $$, toast, del, esc } from '../../core.js';
import { MEDIA_TYPES, MAX_ATTACHMENTS, MAX_TICKET_BYTES, fileLimit, inferType } from '../../../../shared/uploads.js';
import { sizeLabel, uploadFile } from './upload.js';

/** 拖拽区 + 列表容器的静态外壳。purpose 只影响文案和 accept 白名单。 */
function pickerShell(purpose, max) {
  const isImageOnly = purpose === 'public-image';
  const headline = isImageOnly ? '选一张图' : '放图片或视频';
  const hint = isImageOnly
    ? '可拖进来，图片最大 20 MB'
    : `拖进来或直接粘贴 · 图片 20 MB / 视频 100 MB · 最多 ${max} 个，合计 200 MB`;
  // accept 给的是浏览器文件选择器的白名单；public-image 只放图片类型过
  const accept = MEDIA_TYPES.filter((t) => !isImageOnly || t.startsWith('image/')).join(',');

  return (
    `<div class="upload-drop" tabindex="0" role="button" aria-label="放文件进来">` +
    `<strong>＋ ${headline}</strong>` +
    `<span>${hint}</span>` +
    `<input type="file" hidden ${max > 1 ? 'multiple' : ''} accept="${accept}">` +
    `</div>` +
    `<div class="upload-list" aria-live="polite"></div>`
  );
}

/** 列表里每一行的状态文案。注意判定顺序和原来的 `error||ready` 是一回事。 */
function itemStateText(item) {
  // 原式是 `esc(item.error || item.ready ? '已传到市政厅' : ...)`，
  // 靠运算符优先级把 `(item.error || item.ready)` 当条件用。这里补了括号，
  // 判定结果完全一致，只是别再被后人「顺手整理」成 item.ready || item.error。
  const state = item.error || item.ready ? '已传到市政厅' : item.pending ? '正在传…' : '还没开始';
  return sizeLabel(item.file.size) + ' · ' + esc(state);
}

/** 一行 = 预览 + 文件名/进度 + 操作按钮 */
function itemRow(item, index) {
  const preview = item.mime.startsWith('image/')
    ? `<img src="${esc(item.preview)}" alt="">`
    : `<video src="${esc(item.preview)}" preload="metadata" muted></video>`;
  const retry = item.error ? `<button type="button" data-retry="${index}">再传一次</button>` : '';

  return (
    `<div class="upload-row" data-index="${index}">` +
    `<div class="upload-preview">${preview}</div>` +
    `<div class="upload-info">` +
    `<b>${esc(item.file.name)}</b>` +
    `<small>${itemStateText(item)}</small>` +
    `<progress max="100" value="${item.percent}">${item.percent}%</progress>` +
    `</div>` +
    `<div class="upload-actions">` +
    retry +
    `<button type="button" data-remove="${index}">拿掉</button>` +
    `</div>` +
    `</div>`
  );
}

/**
 * 在弹窗底部挂一个附件选择器。
 * @param {Element} dialog 宿主弹窗（需要 .form-grid）
 * @param {object} opts
 * @param {string} opts.purpose       'ticket' 或 'public-image'
 * @param {number} opts.max           最多几个（1 时不显示 multiple）
 * @param {number} opts.existingBytes 这单已经占掉的字节，和新选的一起算总量
 * @returns {{files:()=>object[], ids:()=>string[], commit:()=>void, element:Element}}
 */
export function attachmentPicker(dialog, { purpose = 'ticket', max = MAX_ATTACHMENTS, existingBytes = 0 } = {}) {
  /** 每个条目：{file,mime,preview,percent,pending,ready,error,id,upload,controller,removed,committed} */
  const items = [];
  /** 弹窗关掉后置位：之后所有异步回调都不许再碰 DOM */
  let closed = false;

  const box = document.createElement('section');
  box.className = 'attachment-picker wide';
  box.innerHTML = pickerShell(purpose, max);
  $('.form-grid', dialog).append(box);

  const input = $('input', box);
  const drop = $('.upload-drop', box);
  const list = $('.upload-list', box);

  function draw() {
    // 还在传 / 弹窗正在提交 → 提交按钮锁住，title 告诉用户在等什么
    const submit = $('button[type=submit]', dialog);
    if (submit) {
      const waiting = items.some((item) => !item.ready);
      submit.disabled = dialog.dataset.saving === 'true' || waiting;
      submit.title = waiting ? '等文件传完再递' : '';
    }

    list.innerHTML = items.map(itemRow).join('');

    $$('[data-retry]', list).forEach((b) => {
      b.onclick = () => start(items[+b.dataset.retry]);
    });
    $$('[data-remove]', list).forEach((b) => {
      b.onclick = () => {
        const index = +b.dataset.remove;
        const item = items[index];
        // 先打标记再 abort：start() 的 finally 靠它判断「这行用户已经不要了」
        item.removed = true;
        item.controller?.abort();
        if (item.id) del('/api/uploads?id=' + item.id).catch(() => {});
        URL.revokeObjectURL(item.preview);
        items.splice(index, 1);
        draw();
      };
    });
  }

  /** 起一次（可能续传的）上传，把状态写回 item */
  async function start(item) {
    if (item.pending) return;
    item.error = '';
    item.pending = true;
    item.controller = new AbortController();
    draw();

    try {
      item.upload = await uploadFile(item.file, {
        purpose,
        signal: item.controller.signal,
        // 有 id 说明是「再传一次」：走断点续传，不重开一条
        resumeId: item.id,
        onCreated: (id) => (item.id = id),
        progress: (n) => {
          item.percent = n;
          if (closed) return;
          // 只改这一行的进度条。整表 draw() 会把用户正在点的按钮刷没
          const bar = $('[data-index="' + items.indexOf(item) + '"] progress', list);
          if (bar) {
            bar.value = n;
            bar.textContent = n + '%';
          }
        },
      });
      item.ready = true;
    } catch (e) {
      // 用户已经点掉的那行不写错误：它马上要被 splice 走了
      if (!item.removed) item.error = e.message;
    } finally {
      item.pending = false;
      // 「拿掉」发生在上传途中：abort 只停了请求，服务端那条半成品要在这补删
      if (item.removed && item.id) del('/api/uploads?id=' + item.id).catch(() => {});
      if (!closed) draw();
    }
  }

  /** 三个入口（点选 / 拖拽 / 粘贴）最后都汇到这里 */
  function add(files) {
    for (const file of files) {
      if (items.length >= max) {
        toast(`最多 ${max} 个，箱子就这么大`, true);
        break;
      }
      const usedBytes = items.reduce((sum, item) => sum + item.file.size, 0);
      if (existingBytes + usedBytes + file.size > MAX_TICKET_BYTES) {
        toast('这些加起来超过 200 MB 了，先挑要紧的', true);
        continue;
      }
      // 这里再挡一次：拖进来的文件绕过了 input 的 accept 白名单
      const mime = inferType(file);
      if (!mime || (purpose === 'public-image' && !mime.startsWith('image/')) || file.size > fileLimit(mime) || !file.size) {
        toast('这文件收不了：格式不对，或者超了大小', true);
        continue;
      }
      const item = { file, mime, preview: URL.createObjectURL(file), percent: 0, pending: false };
      items.push(item);
      start(item);
    }
    // 清空 input：同一个文件再选一次也要能触发 onchange
    input.value = '';
    draw();
  }

  // 点空白处才打开文件框。点在 input 上（hidden 控件的边缘）不再触发一次
  drop.onclick = (event) => {
    if (event.target !== input) input.click();
  };
  // role="button" 的键盘可达性：drop 是 div，得自己补 Enter / 空格
  drop.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  };
  input.onchange = () => add(input.files);

  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
    add(e.dataTransfer.files);
  };

  // 监听在 dialog 上而不是 box 上：焦点在标题输入框时直接 Ctrl+V 也能贴进来
  dialog.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      add(files);
    }
  });

  dialog.addEventListener('close', () => {
    closed = true;
    for (const item of items) {
      item.controller?.abort();
      URL.revokeObjectURL(item.preview);
      // committed 的已经随工单发出去了，删了会连累工单上的附件
      if (item.id && !item.committed) del('/api/uploads?id=' + item.id).catch(() => {});
    }
  });

  return {
    /** 全部传完才返回；没传完直接抛错，让弹窗的 submit 走错误分支 */
    files() {
      if (items.some((i) => !i.ready)) throw new Error('还有文件没传完：等它传完，或拿掉失败的');
      return items.map((i) => i.upload);
    },
    ids() {
      return this.files().map((f) => f.id);
    },
    /** 弹窗提交成功后调用：这些上传已经归工单了，关闭时别再删 */
    commit() {
      items.forEach((i) => (i.committed = true));
    },
    element: box,
  };
}
