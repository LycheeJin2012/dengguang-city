/**
 * 附件上传：分片、断点续传、三次重试。
 *
 * 原来这一整套塞在 js/app/attachments.js 的一行里，和「附件选择器」的 DOM 逻辑
 * 混在一起。这里只管把一个 File 变成服务端的一条 upload 记录，不碰任何 DOM。
 *
 * 协议（/api/uploads，三种调用，路径不能改）：
 *   POST /api/uploads              {name,mime,size,purpose}  → 开一个新上传，拿到 id
 *   PUT  /api/uploads?id=&part=    {data}                     传第 n 片（base64）
 *   POST /api/uploads              {action:'finish',id}      合并成成品
 *   GET  /api/uploads?id=          → 查断点：已传 parts[] 和 status
 *
 * 三个不能改的行为，都是踩过坑的：
 *   1. **断点续传**：带 resumeId 进来时先 GET 一次。服务端说 status==='ready'
 *      说明上一轮已经传完并合并了，直接返回它 —— 不能再走一遍 PUT，
 *      那是往一条已完成的记录上补片。
 *   2. **重试只针对 5xx 和网络错**：catch 里 `error.status < 500` 就 break，
 *      也就是 4xx（文件太大、类型不对、没权限）不重试 —— 重发三次结果一样，
 *      只会让用户多等 6 秒才看到那句真正的错误。
 *   3. **每片传完都要报进度**，包括本来就是已传过的片（`!uploaded.has(part)` 的
 *      else 分支）。少报一次，进度条就会在断点续传时卡在中途不动。
 */

import { api } from '../../core.js';
import { CHUNK_SIZE, MEDIA_TYPES, fileLimit, inferType } from '../../../../shared/uploads.js';

/** 一片最多转多少字节。String.fromCharCode 一次吃太多会爆调用栈。 */
const BASE64_CHUNK = 16384;

/** 附件大小的人话。工单里、图片卡片上都用这个。 */
export const sizeLabel = (n) =>
  n < 1024 * 1024 ? Math.ceil(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';

/** ArrayBuffer → base64。分片拼字符串，避免一次 spread 几十万个参数。 */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * 把一个 File 传成服务端的成品记录（可断点续传）。
 * @param {File} file
 * @param {object} opts
 * @param {string} opts.purpose   'ticket' 或 'public-image'
 * @param {(percent:number)=>void} opts.progress 0-100
 * @param {AbortSignal} [opts.signal] 外部取消（用户点了「拿掉」）
 * @param {string} [opts.resumeId] 续传时传上次拿到的 id
 * @param {(id:string)=>void} [opts.onCreated] 新建成功后回调，供选择器记下 id
 * @returns {Promise<object>} finish 返回的成品记录
 */
export async function uploadFile(
  file,
  { purpose = 'ticket', progress = () => {}, signal, resumeId, onCreated = () => {} } = {}
) {
  const mime = inferType(file);
  if (!MEDIA_TYPES.includes(mime) || (purpose === 'public-image' && !mime.startsWith('image/'))) {
    throw new Error('只收图片和视频，别的格式收不了');
  }
  if (file.size < 1 || file.size > fileLimit(mime)) {
    throw new Error('图片最大 20 MB，视频最大 100 MB');
  }

  let id = resumeId;
  let parts = [];

  if (id) {
    const metadata = await api('/api/uploads?id=' + id, { signal });
    parts = metadata.parts;
    // 上一轮已经合并完了：直接交成品，别再 PUT（往已完成的记录上补片会 409）
    if (metadata.status === 'ready') {
      progress(100);
      return metadata;
    }
  } else {
    const created = await api('/api/uploads', {
      method: 'POST',
      body: { name: file.name, mime, size: file.size, purpose },
      signal,
    });
    id = created.id;
    // 立刻把 id 交出去：之后用户点「拿掉」，选择器才知道要去删哪条
    onCreated(id);
  }

  const uploaded = new Set(parts);
  const total = Math.ceil(file.size / CHUNK_SIZE);

  for (let part = 0; part < total; part++) {
    if (signal?.aborted) throw new Error('上传停了');

    // 断点续传：服务端已有的片直接跳过，但下面的 progress 照样要跑
    if (!uploaded.has(part)) {
      const end = Math.min(file.size, (part + 1) * CHUNK_SIZE);
      const data = toBase64(await file.slice(part * CHUNK_SIZE, end).arrayBuffer());

      let failure;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await api(`/api/uploads?id=${id}&part=${part}`, { method: 'PUT', body: { data }, signal });
          failure = null;
          break;
        } catch (error) {
          failure = error;
          // 用户取消，或 4xx（重发也没用的业务错）—— 不再重试
          if (signal?.aborted || (error.status && error.status < 500)) break;
        }
      }
      if (failure) throw failure;
    }

    progress(Math.round(((part + 1) / total) * 100));
  }

  const result = await api('/api/uploads', { method: 'POST', body: { action: 'finish', id }, signal });
  progress(100);
  return result;
}
