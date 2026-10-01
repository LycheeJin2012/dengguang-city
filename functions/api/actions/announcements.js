// v44 重写: 公告管理 (super only)
// 路由: POST /api/init?action=announcement-create | announcement-update | announcement-delete
//
// v88.7 去压缩重写: 只改排版与结构, 行为一个字都没动。
//
// 【当前状态: 孤儿文件】全仓库没有任何文件 import 它。init.js:99-107 把所有
// announcement-* 动作转给 _core/resources.js(那条路有 notification_log 扇出、
// 有严格图片白名单), 所以本文件只能靠直接 POST /api/actions/announcements 命中
// —— 一个非文档 URL。它与正规实现已经漂移, 四处已坐实的差异:
//   1. parseInt 太宽松: ?id=2abc 会被吃成 2 并**真的**删掉 2 号公告
//   2. 只校验 data:image/ 前缀, 所以 data:image/svg+xml 一起放行(SVG 能带脚本);
//      正规实现的 data:image/(png|jpeg|webp|gif);base64, 白名单会挡掉它
//   3. 原始 SQL 错误直接外泄给客户端(能读到 "no such table: announcements")
//   4. 删/改不存在的行也照样回 deleted:true / ok:true
// **本轮一律不修**: 删文件是不可逆的 API 变更, 修缺陷要单独决策。
// 四条都有可执行的证据钉在 tests/admin-actions-equiv.test.js 里。
import { ok, err, readToken, getSession, stripHtml } from '../../_shared.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return err(500, 'D1 binding DB not configured');
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // 所有公告 action 都需要 super 权限
  const token = readToken(request);
  if (!token) return err(401, '需要管理员登录');
  const sess = await getSession(env, token);
  if (!sess || !sess.admin_id) return err(403, '需要管理员权限');
  // v88.7 保留(v88.7 未改): 这一行永远走不到 —— getSession 见到过期会话已经先把它
  // 删掉并返回 null 了, 能走到这里的会话 expires_at 一定还没到。死代码, 原样保留。
  if (new Date(sess.expires_at) <= new Date()) return err(401, '会话已过期');
  const me = await env.DB.prepare('SELECT id, role FROM admins WHERE id = ?').bind(sess.admin_id).first();
  if (!me || me.role !== 'super') return err(403, '只有 super 管理员可操作公告');

  // 删除分支在校验之前 return: 它只看 id, body 再离谱也照删不误
  if (action === 'announcement-delete') return deleteAnnouncement(env, url);

  // create / update 共用字段验证。注意顺序: 校验跑在 action 分发**之前**,
  // 所以未知 action 配一个非法 title 拿到的是 400 而不是 404。
  const fields = await readFields(request);
  const invalid = validateFields(fields);
  if (invalid) return invalid;

  if (action === 'announcement-create') return createAnnouncement(env, fields, me.id);
  if (action === 'announcement-update') return updateAnnouncement(env, fields, url);

  return err(404, '未知 announcement action: ' + action);
}

/**
 * 取 create / update 共用的三个字段。
 *
 * title 与 content 过 stripHtml(摘标签 + 转义残留尖括号 + 截到 2000 字)再 trim;
 * image_url **不过** stripHtml, 只 trim。
 * 连带后果(v88.7 未改): content 超 2000 字会被 stripHtml 悄悄截成 2000 字后放行,
 * 而不是按 2000 字上限拒掉。
 */
async function readFields(request) {
  const body = await request.json().catch(() => ({}));
  return {
    title: stripHtml((body.title || '').toString()).trim(),
    content: stripHtml((body.content || '').toString()).trim(),
    image_url: (body.image_url || '').toString().trim(),
  };
}

/** 返回第一处不合法对应的错误响应, 全通过则返回 null */
function validateFields({ title, content, image_url }) {
  if (title.length < 2 || title.length > 80) return err(400, '标题 2-80 字');
  if (content.length < 2 || content.length > 2000) return err(400, '内容 2-2000 字');
  if (image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\//i.test(image_url)) {
    return err(400, '封面图必须是 https:// 或 data:image/ 开头');
  }
  return null;
}

/** 从 URL 上取公告 id —— v88.7 保留(v88.7 未改): parseInt 太宽松, '2abc' 会被吃成 2 */
function readId(url) {
  return parseInt(url.searchParams.get('id') || '0', 10);
}

async function deleteAnnouncement(env, url) {
  const id = readId(url);
  if (!id) return err(400, 'id 必填');
  try {
    await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
    // v88.7 保留(v88.7 未改): 不看 changes, 所以 id=999 这类零行删除也回 deleted:true
    return ok({ id, deleted: true });
  } catch (e) { return err(500, '删除失败: ' + e.message); }
}

async function createAnnouncement(env, fields, adminId) {
  try {
    const result = await env.DB.prepare(
      "INSERT INTO announcements (title, content, image_url, created_by) VALUES (?, ?, ?, ?)"
    ).bind(fields.title, fields.content, fields.image_url || null, adminId).run();
    return ok({ id: result.meta.last_row_id, ok: true });
  } catch (e) { return err(500, '发布失败: ' + e.message); }
}

async function updateAnnouncement(env, fields, url) {
  const id = readId(url);
  if (!id) return err(400, 'id 必填');
  try {
    // v88.7 保留(v88.7 未改): 不看 changes, id 不存在也回 ok:true
    await env.DB.prepare(
      "UPDATE announcements SET title = ?, content = ?, image_url = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(fields.title, fields.content, fields.image_url || null, id).run();
    return ok({ id, ok: true });
  } catch (e) { return err(500, '更新失败: ' + e.message); }
}
