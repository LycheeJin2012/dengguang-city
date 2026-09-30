import { identity, integer, fail } from './request.js';
import { MAX_ATTACHMENTS, MAX_TICKET_BYTES } from '../../shared/uploads.js';

export const uploadUrl = id => '/api/uploads?id=' + encodeURIComponent(id) + '&download=1';

/** 附件 id 是我们自己生成的不透明串：只放行 URL 安全的字符，长度 20–64。 */
export function validId(value) {
  if (typeof value !== 'string' || !/^[-a-zA-Z0-9]{20,64}$/.test(value)) fail(400, '附件 ID 无效');
  return value;
}

/**
 * 决定这次操作以谁的身份进行。
 *
 * 优先用市民身份，失败再退到管理员 —— 这样合并会话里的同一段逻辑
 * 对普通玩家和管理员都成立，而两套 owner 校验都仍然可用。
 */
export async function uploadActor(c) {
  // Prefer the citizen identity in combined sessions, while keeping both owner checks available.
  try { return { kind: 'player', user: await identity(c) }; }
  catch (e) { if (e.status !== 401 && e.status !== 403) throw e; return { kind: 'admin', user: await identity(c, 'admin') }; }
}

export const ownerColumn = actor =>
  actor.kind === 'admin' ? 'owner_admin_id' : actor.kind === 'hotel_owner' ? 'owner_hotel_id' : 'owner_player_id';

export const ownedBy = (upload, actor) => upload[ownerColumn(actor)] === actor.user.id;

/**
 * 取出工单并做回避校验。
 *
 * reference 兼容两种形态：`123` 是 tickets.id，`m:123` 是旧 messages.id。
 * 管理员走 try 分支、玩家走 catch 分支 —— catch 只接 401/403，
 * 其他异常照常往上抛，避免把真实故障伪装成「工单不存在」。
 */
export async function ticketOwner(c, reference) {
  const legacy = String(reference).startsWith('m:');
  const id = integer(legacy ? String(reference).slice(2) : reference);
  const ticket = await c.env.DB
    .prepare(`SELECT id,player_id,target_admin_id,target_player_id FROM ${legacy ? 'messages' : 'tickets'} WHERE id=?`)
    .bind(id)
    .first();
  if (!ticket) fail(404, '工单不存在');
  try {
    const admin = await identity(c, 'admin');
    // 只读（GET）不受回避限制，方便玩家查看自己被投诉的工单
    if (c.request.method !== 'GET' && (ticket.target_admin_id === admin.id || ticket.target_player_id && ticket.target_player_id === admin.linked_player_id)) fail(403, '被投诉人不能处理该工单');
    if (admin.role !== 'super' && (ticket.target_admin_id || ticket.target_player_id === admin.linked_player_id)) fail(403, '此投诉仅限超管处理');
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    const p = await identity(c);
    // 对本人也报 404：泄露「这张单存在」本身就是信息
    if (ticket.player_id !== p.id) fail(404, '工单不存在');
  }
  return ticket;
}

export function fileMetadata(file) {
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, url: uploadUrl(file.id) };
}

export async function ticketFiles(db, reference) {
  const r = await db
    .prepare("SELECT u.id,u.name,u.mime,u.size FROM media_uploads u JOIN ticket_attachments a ON a.upload_id=u.id WHERE a.ticket_ref=? AND u.status='ready' ORDER BY u.created_at,u.id")
    .bind(String(reference))
    .all();
  return r.results.map(fileMetadata);
}

/**
 * 校验一组附件 id。
 *
 * 三道关：数量上限 + 去重、归属/用途/上传状态、是否已被别的工单占用。
 * 体积合计放最后 —— 前面的失败更便宜，而且失败信息更具体。
 */
export async function validateFiles(c, ids, actor, purpose = 'ticket') {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || new Set(ids).size !== ids.length) fail(400, `每个工单最多 ${MAX_ATTACHMENTS} 个不同附件`);
  const files = [];
  for (const id of ids) {
    validId(id);
    const file = await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first();
    if (!file || !ownedBy(file, actor) || file.purpose !== purpose || file.status !== 'ready') fail(400, '附件尚未上传完成或不属于当前账号');
    // 已关联工单的附件不给二次使用：否则换个工单就能把别处的附件挂过来
    if (purpose === 'ticket' && await c.env.DB.prepare('SELECT upload_id FROM ticket_attachments WHERE upload_id=?').bind(id).first()) fail(409, '附件已关联其他工单，请重新选择文件');
    files.push(file);
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TICKET_BYTES) fail(413, '每个工单的附件合计不能超过 200 MB');
  return files;
}

export function imageUploadId(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/uploads?')) return null;
  const url = new URL(value, 'https://local.invalid');
  return validId(url.searchParams.get('id'));
}

/**
 * 校验一张「对外展示」的图片。
 *
 * public_access=1 的图谁都能用；未发布的图只有 owner 自己能用，
 * 所以这里比对的是 hotel_owner_id / owner_admin_id 而不是 player_id。
 */
export async function validatePublicImage(c, value, admin) {
  const id = imageUploadId(value);
  if (!id) return null;
  const file = await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first();
  if (!file || file.status !== 'ready' || file.purpose !== 'public-image' || !file.mime.startsWith('image/')) fail(400, '图片尚未上传完成');
  if (!file.public_access && (admin.kind === 'hotel_owner' ? file.owner_hotel_id !== admin.id : file.owner_admin_id !== admin.id)) fail(403, '不能使用其他人的未发布图片');
  return id;
}
