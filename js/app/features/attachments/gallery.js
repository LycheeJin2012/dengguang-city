/**
 * 附件陈列：工单详情里「你递的材料」那一栏。
 *
 * 和选择器（picker.js）分开，因为这个是**只读**的：看已经传完的东西，不需要
 * 拖拽、不需要 AbortController、也不需要往 .form-grid 里 append。
 * 原来它和上传逻辑挤在同一个文件里，两边都很难读。
 *
 * 两个不能改的点：
 *   1. **URL 上的 &save=1**：「取原件」是在原下载链接后追加参数让浏览器
 *      直接落盘。附件是私有链接（谁拿到链接谁看得到），所以下面那句提醒文案
 *      和这个链接是一套的，别单独改其中一半。
 *   2. **附件永远不公开**。公开 API 根本不返回 attachments 字段（见
 *      functions/ 里的公开工单白名单），这里能渲染出来的一定是本人或
 *      有权限的管理员看到的。前端不要再自己加一层过滤。
 */

import { esc } from '../../core.js';
import { sizeLabel } from './upload.js';

/** 一个附件卡：可点开的预览 + 文件名 + 大小 + 取原件 */
function attachmentCard(f) {
  const preview = f.mime.startsWith('image/')
    ? `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`
    : `<video controls preload="metadata" playsinline src="${esc(f.url)}"></video>`;

  return (
    `<article class="attachment-card">` +
    preview +
    `<b>${esc(f.name)}</b>` +
    `<small>${sizeLabel(f.size)}</small>` +
    `<a href="${esc(f.url)}&save=1">取原件</a>` +
    `</article>`
  );
}

/**
 * 渲染附件陈列区。
 * @param {Array<{mime:string,url:string,name:string,size:number}>} files
 * @returns {string} HTML；没有附件时返回空串（不是占位块）
 */
export function renderAttachments(files = []) {
  if (!files.length) return '';
  return (
    `<section class="attachment-gallery">` +
    `<h3>你递的材料 (${files.length})</h3>` +
    `<div class="attachment-grid">${files.map(attachmentCard).join('')}</div>` +
    `<small>图片放不出来、视频播不动，就取原件自己看。材料只在这张工单里，谁拿到链接谁看得到，别乱转。</small>` +
    `</section>`
  );
}
