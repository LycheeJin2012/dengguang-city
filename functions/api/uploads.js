import { endpoint, identity, body, string, integer, reply, fail } from '../_core/request.js';
import {
  validId,
  uploadActor,
  ownerColumn,
  ownedBy,
  fileMetadata,
  ticketOwner,
} from '../_core/uploads.js';
import { CHUNK_SIZE, MEDIA_TYPES, fileLimit, matchesSignature, decodeBase64 } from '../../shared/uploads.js';

/** 单个上传者未提交附件的占用上限。 */
const STORAGE_LIMIT = 250 * 1024 * 1024;

/** 一次流式读取最多取多少个分块。 */
const STREAM_BATCH = 16;

/**
 * 取出附件并确认当前身份是它的所有者。
 *
 * 所有者身份由文件上记的 owner_* 字段决定（管理员 / 酒店经营 / 玩家），
 * 拿错身份类型去查会直接 401/403，不会误放行。
 */
async function owned(c, id) {
  const file = await c.env.DB
    .prepare('SELECT * FROM media_uploads WHERE id=?')
    .bind(validId(id))
    .first();
  if (!file) fail(404, '附件不存在');

  const actor = file.owner_admin_id
    ? { kind: 'admin', user: await identity(c, 'admin') }
    : file.owner_hotel_id
      ? { kind: 'hotel_owner', user: await identity(c, 'hotel_owner') }
      : { kind: 'player', user: await identity(c) };

  if (!ownedBy(file, actor)) fail(404, '附件不存在');
  return { file, actor };
}

/**
 * POST /api/uploads —— 两种动作：
 *   ?action 不带 / 其它  创建上传草稿，返回 id + 分块参数
 *   action=finish        校验分片齐了没有，齐了就置 ready
 *
 * 上传流程是「先建草稿 → PUT 逐块传 → finish」，所以 size 和分块数
 * 是建草稿时就定死的，PUT 阶段只按它校验，不重新算。
 */
export const onRequestPost = (c) =>
  endpoint(async () => {
    const input = await body(c.request);

    if (input.action === 'finish') {
      const { file } = await owned(c, input.id);
      // 幂等：已经 ready 再点一次直接回元数据。
      if (file.status === 'ready') return reply(fileMetadata(file));

      // 块数或总字节数对不上就是有分块丢了，让客户端重传缺的那几块。
      const summary = await c.env.DB
        .prepare(
          'SELECT COUNT(*) AS n,COALESCE(SUM(byte_size),0) AS size FROM media_chunks WHERE upload_id=?'
        )
        .bind(file.id)
        .first();
      if (summary.n !== file.chunk_count || summary.size !== file.size) {
        fail(409, '上传尚未完成，请重试缺失分块');
      }

      await c.env.DB
        .prepare("UPDATE media_uploads SET status='ready' WHERE id=?")
        .bind(file.id)
        .run();
      return reply(fileMetadata(file));
    }

    // 公开图片（用在前台画廊等）：超管，或酒店经营。
    // 先试超管，失败再退到酒店经营；其它错误照抛。
    let actor;
    if (input.purpose === 'public-image') {
      try {
        actor = { kind: 'admin', user: await identity(c, 'super') };
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) throw e;
        actor = { kind: 'hotel_owner', user: await identity(c, 'hotel_owner') };
      }
    } else {
      actor = await uploadActor(c);
    }

    const purpose = input.purpose || 'ticket';
    if (!['ticket', 'public-image'].includes(purpose)) fail(400, '上传用途无效');

    const mime = string(input.mime, '文件类型', 100);
    // 公开图片只收 image/*，工单附件图片视频都行。
    if (!MEDIA_TYPES.includes(mime) || (purpose === 'public-image' && !mime.startsWith('image/'))) {
      fail(400, '请选择支持的图片或视频');
    }

    const size = integer(input.size, '文件大小', 1, fileLimit(mime));
    // 文件名要去掉控制字符和路径分隔符，避免拼 header 时出问题。
    const name = string(input.name, '文件名', 180).replace(/[\x00-\x1f\x7f/\\]/g, '_');

    // Bound unfinished storage; old unlinked uploads expire after a day.
    // 只清 public_access=0 且没挂上任何工单的草稿 —— 已提交的附件不算在内。
    // 先删分块再删主记录（反过来会留下指向空壳的分块）。
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM media_chunks WHERE upload_id IN (SELECT u.id FROM media_uploads u WHERE u.created_at<datetime('now','-1 day') AND u.public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=u.id))"
      ),
      c.env.DB.prepare(
        "DELETE FROM media_uploads WHERE created_at<datetime('now','-1 day') AND public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=media_uploads.id)"
      ),
    ]);

    // 算新草稿前先看这个人已占了多少，防止靠建一堆草稿撑爆配额。
    const used = await c.env.DB
      .prepare(
        `SELECT COALESCE(SUM(size),0) AS bytes FROM media_uploads u WHERE ${ownerColumn(actor)}=? AND public_access=0 AND NOT EXISTS(SELECT 1 FROM ticket_attachments a WHERE a.upload_id=u.id)`
      )
      .bind(actor.user.id)
      .first();
    if (used.bytes + size > STORAGE_LIMIT) fail(413, '未提交的附件过多，请先提交工单或移除附件');

    const id = crypto.randomUUID();
    const chunkCount = Math.ceil(size / CHUNK_SIZE);
    await c.env.DB
      .prepare(
        `INSERT INTO media_uploads(id,${ownerColumn(actor)},name,mime,size,chunk_count,purpose) VALUES(?,?,?,?,?,?,?)`
      )
      .bind(id, actor.user.id, name, mime, size, chunkCount, purpose)
      .run();

    return reply({ id, chunk_size: CHUNK_SIZE, chunk_count: chunkCount }, 201);
  });

/**
 * PUT /api/uploads?id=&part= —— 传一个分块。
 *
 * 三道校验依次是：base64 形态合法 → 解出来长度正好 → 首块的魔数与 mime 相符。
 * 魔数这道是关键：不然改个扩展名就能把任意文件当图片存下来。
 */
export const onRequestPut = (c) =>
  endpoint(async () => {
    const url = new URL(c.request.url);
    const { file } = await owned(c, url.searchParams.get('id'));
    if (file.status !== 'uploading') fail(409, '附件已经上传完成');

    // 最后一块的 part 编号上界是 chunk_count-1。
    const index = integer(url.searchParams.get('part'), '分块编号', 0, file.chunk_count - 1);
    const input = await body(c.request);

    const maxEncodedLength = Math.ceil(CHUNK_SIZE / 3) * 4;
    if (
      typeof input.data !== 'string' ||
      input.data.length > maxEncodedLength ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
    ) {
      fail(400, '分块数据无效');
    }

    let bytes;
    try {
      bytes = decodeBase64(input.data);
    } catch {
      fail(400, '分块编码无效');
    }

    // 每块的期望长度：中间块满，最后一块是余数。
    const expected = Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE);
    if (bytes.length !== expected) fail(400, '分块大小不正确');

    if (index === 0 && !matchesSignature(bytes, file.mime)) {
      fail(400, '文件内容与图片/视频类型不匹配');
    }

    // upsert：断点续传时重传同一块是允许的。
    // SELECT ... FROM media_uploads 保证草稿还在且还在 uploading，
    // 已经被删除或完成的草稿会让 changes=0。
    const saved = await c.env.DB
      .prepare(
        "INSERT INTO media_chunks(upload_id,part,data,byte_size) SELECT ?,?,?,? FROM media_uploads WHERE id=? AND status='uploading' ON CONFLICT(upload_id,part) DO UPDATE SET data=excluded.data,byte_size=excluded.byte_size"
      )
      .bind(file.id, index, input.data, bytes.length, file.id)
      .run();
    if (!saved.meta.changes) fail(409, '上传已取消或完成');

    return reply({ part: index, received: bytes.length });
  });

/**
 * GET /api/uploads —— 查元信息，或带 ?download=1 直接下载。
 *
 * 下载支持 Range，断点续传和视频拖动进度条都靠它。
 */
export const onRequestGet = (c) =>
  endpoint(async () => {
    const url = new URL(c.request.url);
    const id = validId(url.searchParams.get('id'));

    const file = await c.env.DB
      .prepare('SELECT * FROM media_uploads WHERE id=?')
      .bind(id)
      .first();
    if (!file) fail(404, '附件不存在');

    const attachment = await c.env.DB
      .prepare('SELECT ticket_ref FROM ticket_attachments WHERE upload_id=?')
      .bind(id)
      .first();

    // 非公开附件要过所有者校验。这里故意吞掉鉴权异常：
    // 匿名访问不该知道「这个 id 存不存在」，但已挂工单的附件还有一条
    // 按工单可见性放行的路。
    if (!file.public_access) {
      let actor;
      try {
        actor = file.owner_admin_id
          ? { kind: 'admin', user: await identity(c, 'admin') }
          : file.owner_hotel_id
            ? { kind: 'hotel_owner', user: await identity(c, 'hotel_owner') }
            : { kind: 'player', user: await identity(c) };
      } catch (e) {
        if (e.status !== 401 && e.status !== 403) throw e;
      }
      if (!actor || !ownedBy(file, actor)) {
        if (!attachment) fail(404, '附件不存在');
        // 交给工单可见性判：被投诉人 / 他人私密工单会在这里被拒。
        await ticketOwner(c, attachment.ticket_ref);
      }
    }

    if (url.searchParams.get('download') !== '1') {
      const chunks = await c.env.DB
        .prepare('SELECT part FROM media_chunks WHERE upload_id=? ORDER BY part')
        .bind(id)
        .all();
      return reply({
        ...fileMetadata(file),
        status: file.status,
        parts: chunks.results.map((row) => row.part),
        chunk_count: file.chunk_count,
        chunk_size: CHUNK_SIZE,
      });
    }

    if (file.status !== 'ready') fail(409, '附件尚未上传完成');

    // 解析 Range 头，算出 [start,end]。格式不合法或越界一律 416。
    let start = 0;
    let end = file.size - 1;
    const range = c.request.headers.get('Range');
    if (range) {
      const range416 = () =>
        new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${file.size}` },
        });

      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return range416();
      if (!match[1]) {
        // bytes=-N：取末尾 N 字节。
        const suffix = Number(match[2]);
        start = Math.max(0, file.size - suffix);
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= file.size
      ) {
        return range416();
      }
    }

    // 分块存库，所以要按 part 顺序边读边吐。buffered 是预读的窗口，
    // cancel() 时清掉，避免客户端中断后还在拉数据。
    let part = Math.floor(start / CHUNK_SIZE);
    const last = Math.floor(end / CHUNK_SIZE);
    let buffered = [];
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (part > last) {
            controller.close();
            return;
          }
          if (!buffered.length) {
            const rows = await c.env.DB
              .prepare(
                `SELECT part,data FROM media_chunks WHERE upload_id=? AND part>=? AND part<=? ORDER BY part LIMIT ${STREAM_BATCH}`
              )
              .bind(id, part, last)
              .all();
            buffered = rows.results;
          }
          const row = buffered.shift();
          // 缺块就报错中断，不能跳过去 —— 跳过去会让视频静默截断。
          if (!row || row.part !== part) throw new Error('附件分块缺失');
          const bytes = decodeBase64(row.data);
          const base = part * CHUNK_SIZE;
          // 按 Range 切出这一块里真正要发的部分。
          controller.enqueue(
            bytes.slice(Math.max(0, start - base), Math.min(bytes.length, end - base + 1))
          );
          part++;
        } catch (e) {
          controller.error(e);
        }
      },
      cancel() {
        buffered = [];
      },
    });

    const headers = {
      'Content-Type': file.mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': file.public_access ? 'public, max-age=3600' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `${url.searchParams.get('save') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    return new Response(stream, { status: range ? 206 : 200, headers });
  });

/**
 * DELETE /api/uploads?id= —— 删掉上传草稿。
 * 已挂到工单上、或标了公开的不能删：它们已经是对外可见的内容，不是草稿了。
 */
export const onRequestDelete = (c) =>
  endpoint(async () => {
    const { file } = await owned(c, new URL(c.request.url).searchParams.get('id'));

    if (
      file.public_access ||
      (await c.env.DB
        .prepare('SELECT upload_id FROM ticket_attachments WHERE upload_id=?')
        .bind(file.id)
        .first())
    ) {
      fail(409, '已提交的附件不能从上传草稿中移除');
    }

    // 分块先删，否则 media_uploads 删掉后分块就成了没人认领的孤儿。
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM media_chunks WHERE upload_id=?').bind(file.id),
      c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(file.id),
    ]);
    return reply({ deleted: true });
  });
