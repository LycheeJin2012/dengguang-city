import { enterWithPassword, leaveAdministration } from './admin-session.js';
import { claimPendingRewards } from './ticket-policy.js';
import { endpoint, identity, body, string, integer, reply, fail } from './request.js';
import { hashPassword, verifyPassword } from '../_shared/auth.js';
import { isUsername, isEmail } from '../_shared/validators.js';
import { readToken } from '../_shared/session.js';

export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, '密码需 8–128 位');
  return value;
}

export function username(value) {
  const name = string(value, '游戏 ID', 32);
  if (!isUsername(name) || /[<>]/.test(name)) fail(400, '游戏 ID 格式无效');
  return name;
}

export async function changePassword(c, kind) {
  const isAdmin = kind === 'admin';
  const me = await identity(c, isAdmin ? 'admin' : 'player');
  const input = await body(c.request);
  const table = isAdmin ? 'admins' : 'players';
  const column = isAdmin ? 'admin_id' : 'player_id';

  const row = await c.env.DB.prepare(`SELECT password_hash,salt FROM ${table} WHERE id=?`).bind(me.id).first();
  if (typeof input.old_password !== 'string' || !(await verifyPassword(input.old_password, row.password_hash, row.salt))) {
    fail(401, '原密码错误');
  }

  const { hash, salt } = await hashPassword(password(input.new_password));

  // 改完密码立刻踢掉自己的其它会话，但保留当前这次（token!=?）。
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ${table} SET password_hash=?,salt=? WHERE id=?`).bind(hash, salt, me.id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE ${column}=? AND token!=?`).bind(me.id, readToken(c.request)),
  ]);
  return reply({ changed: true });
}

// 绑定 / 解绑管理员与市民账号。解绑时要额外清理 passkeys 和会话，
// 否则会留下能单独通过 passkey 进后台的孤儿凭证。
async function linkAccounts(c, action, adminId, playerId) {
  const admin = await c.env.DB.prepare('SELECT * FROM admins WHERE id=?').bind(adminId).first();
  const player = await c.env.DB.prepare('SELECT * FROM players WHERE id=?').bind(playerId).first();
  if (!admin || !player) fail(404, '账号不存在');

  const linking = action === 'admin-merge-account';
  if (linking) {
    if (player.status !== 'active') fail(400, '只能绑定已激活的市民');
    if ((admin.linked_player_id && admin.linked_player_id !== playerId) || (player.linked_admin_id && player.linked_admin_id !== adminId)) {
      fail(409, '账号已绑定其他账号，请先解绑');
    }
  } else if (admin.linked_player_id !== playerId || player.linked_admin_id !== adminId) {
    fail(409, '账号绑定关系已变化，请刷新');
  }

  const queries = [
    c.env.DB.prepare('UPDATE admins SET linked_player_id=? WHERE id=?').bind(linking ? playerId : null, adminId),
    c.env.DB.prepare('UPDATE players SET linked_admin_id=? WHERE id=?').bind(linking ? adminId : null, playerId),
  ];
  if (!linking) {
    queries.push(
      c.env.DB.prepare('UPDATE passkeys SET admin_id=NULL WHERE player_id=? AND admin_id=?').bind(playerId, adminId),
      c.env.DB.prepare('DELETE FROM sessions WHERE player_id=? AND admin_id=?').bind(playerId, adminId)
    );
  }
  await c.env.DB.batch(queries);

  // 绑定成功才能把之前挂在管理员名下的奖励兑现给市民。
  if (linking) await claimPendingRewards(c.env.DB, adminId, playerId);
  return reply({ linked: linking, admin_id: adminId, player_id: playerId });
}

export const accountAction = (c) =>
  endpoint(async () => {
    const action = new URL(c.request.url).searchParams.get('action');
    if (action === 'admin-logout') return leaveAdministration(c);
    if (action === 'player-change-password') return changePassword(c, 'player');

    const input = await body(c.request);
    if (action === 'admin-enter-password') return enterWithPassword(c, input.admin_password);

    // 剩下的全是超管操作。
    await identity(c, 'super');
    const adminId = input.admin_id ? integer(input.admin_id) : null;
    const playerId = integer(input.player_id);

    if (action === 'admin-reset-player-password') {
      const { hash, salt } = await hashPassword(password(input.new_password));
      const result = await c.env.DB.batch([
        c.env.DB.prepare('UPDATE players SET password_hash=?,salt=? WHERE id=?').bind(hash, salt, playerId),
        c.env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(playerId),
      ]);
      if (!result[0].meta.changes) fail(404, '市民不存在');
      return reply({ updated: true });
    }

    if (!['admin-merge-account', 'admin-unmerge-account'].includes(action) || !adminId) fail(400, '操作无效');
    return linkAccounts(c, action, adminId, playerId);
  });

// 收集要改的字段。只放请求里显式出现的键，避免 PATCH 把没传的列清空。
function adminValues(input, me, id) {
  const values = {};
  if (input.specialties !== undefined) values.specialties = string(input.specialties, '职责', 300, { required: false });
  if (input.username !== undefined) values.username = username(input.username);
  if (input.role !== undefined) {
    if (!['admin', 'super'].includes(input.role)) fail(400, '角色无效');
    if (id === me.id && input.role !== 'super') fail(400, '不能降低自己的权限');
    values.role = input.role;
  }
  return values;
}

async function deleteAdmin(env, me, id) {
  if (id === me.id) fail(400, '不能删除自己');
  if (await env.DB.prepare('SELECT id FROM announcements WHERE created_by=? LIMIT 1').bind(id).first()) {
    fail(409, '此管理员有公告记录，请保留账号');
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET linked_admin_id=NULL WHERE linked_admin_id=?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE admin_id=?').bind(id),
    env.DB.prepare('UPDATE passkeys SET admin_id=NULL WHERE admin_id=? AND player_id IS NOT NULL').bind(id),
    env.DB.prepare('DELETE FROM passkeys WHERE admin_id=?').bind(id),
    env.DB.prepare('DELETE FROM admins WHERE id=?').bind(id),
  ]);
  return reply({ deleted: id });
}

export const adminAccounts = (c) =>
  endpoint(async () => {
    const { env, request } = c;
    const method = request.method;
    // 读列表任何管理员都能看；写操作只有超管。
    const me = await identity(c, method === 'GET' ? 'admin' : 'super');
    const url = new URL(request.url);

    if (method === 'GET') {
      return reply({
        admins: (
          await env.DB
            .prepare(
              'SELECT a.id,a.username,a.role,a.specialties,a.created_at,a.linked_player_id,p.username AS linked_player_username FROM admins a LEFT JOIN players p ON p.id=a.linked_player_id ORDER BY a.id'
            )
            .all()
        ).results,
      });
    }

    // POST 建号不需要 id；PATCH / DELETE 必须带一个真实存在的 id。
    const id = method === 'POST' ? null : integer(url.searchParams.get('id'));
    const row = id ? await env.DB.prepare('SELECT * FROM admins WHERE id=?').bind(id).first() : null;
    if (id && !row) fail(404, '管理员不存在');

    if (method === 'DELETE') return deleteAdmin(env, me, id);

    const input = await body(request);
    const values = adminValues(input, me, id);

    if (method === 'POST') {
      if (!values.username) fail(400, '账号必填');
      values.role = values.role || 'admin';
      const { hash, salt } = await hashPassword(password(input.password));
      values.password_hash = hash;
      values.salt = salt;
      const result = await env.DB
        .prepare('INSERT INTO admins(username,role,password_hash,salt,specialties) VALUES(?,?,?,?,?)')
        .bind(values.username, values.role, hash, salt, values.specialties || '')
        .run();
      return reply({ id: result.meta.last_row_id }, 201);
    }

    if (method !== 'PATCH') fail(405, '方法不支持');
    if (input.new_password) {
      const { hash, salt } = await hashPassword(password(input.new_password));
      values.password_hash = hash;
      values.salt = salt;
    }
    if (!Object.keys(values).length) fail(400, '没有修改字段');

    const queries = [
      env.DB
        .prepare(`UPDATE admins SET ${Object.keys(values).map((k) => k + '=?').join(',')} WHERE id=?`)
        .bind(...Object.values(values), id),
    ];
    // 改密码或改角色后，其它已登录会话必须失效（当前会话保留）。
    if (input.new_password || input.role) {
      queries.push(env.DB.prepare('DELETE FROM sessions WHERE admin_id=? AND token!=?').bind(id, readToken(request)));
    }
    await env.DB.batch(queries);
    return reply({ id, updated: true });
  });

export const players = (c) =>
  endpoint(async () => {
    const { env, request } = c;
    const method = request.method;
    // 市民账号由管理员管理，任何管理员都能读，只有超管能写。
    const me = await identity(c, 'admin');
    const url = new URL(request.url);

    if (method === 'GET') {
      const conditions = [];
      const args = [];
      for (const key of ['status']) {
        if (url.searchParams.get(key)) {
          conditions.push(key + '=?');
          args.push(url.searchParams.get(key));
        }
      }
      if (url.searchParams.get('q')) {
        conditions.push('(username LIKE ? OR email LIKE ?)');
        args.push('%' + url.searchParams.get('q') + '%', '%' + url.searchParams.get('q') + '%');
      }
      const result = await env.DB
        .prepare(
          `SELECT id,username,email,game_id,status,bio,avatar_emoji,emeralds,created_at,linked_admin_id FROM players ${
            conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
          } ORDER BY id DESC LIMIT 500`
        )
        .bind(...args)
        .all();
      return reply({ players: result.results });
    }

    if (method === 'POST') {
      if (me.role !== 'super') fail(403, '仅 SUPER 可创建账号');
      const input = await body(request);
      const name = username(input.username);
      const email = string(input.email, '邮箱', 254).toLowerCase();
      if (!isEmail(email)) fail(400, '邮箱无效');
      const { hash, salt } = await hashPassword(password(input.password));
      // game_id 先跟用户名一致，后续改用户名时可以一次性对齐。
      const result = await env.DB
        .prepare("INSERT INTO players(username,game_id,email,password_hash,salt,status) VALUES(?,?,?,?,?,'active')")
        .bind(name, name, email, hash, salt)
        .run();
      return reply({ id: result.meta.last_row_id }, 201);
    }

    if (method !== 'PATCH') fail(405, '方法不支持');
    const id = integer(url.searchParams.get('id'));
    const action = url.searchParams.get('action');
    const row = await env.DB.prepare('SELECT * FROM players WHERE id=?').bind(id).first();
    if (!row) fail(404, '市民不存在');

    if (['approve', 'reject'].includes(action)) {
      // 驳回绑定中的市民等于停用对方管理员的账号，只有超管能做。
      if (row.linked_admin_id && me.role !== 'super') fail(403, '只有 SUPER 可停用关联管理员的市民账号');
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET status=? WHERE id=?').bind(action === 'approve' ? 'active' : 'rejected', id),
        env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(id),
      ]);
      return reply({ id });
    }

    if (me.role !== 'super') fail(403, '仅 SUPER 可操作');
    const input = await body(request);

    if (action === 'reset') {
      const { hash, salt } = await hashPassword(password(input.new_password));
      await env.DB.batch([
        env.DB.prepare('UPDATE players SET password_hash=?,salt=? WHERE id=?').bind(hash, salt, id),
        env.DB.prepare('DELETE FROM sessions WHERE player_id=?').bind(id),
      ]);
      return reply({ id });
    }

    if (action === 'rename') {
      const name = username(input.new_username);
      // game_id 只有在还等于旧用户名时才跟着改，避免覆盖玩家自己填过的编号。
      await env.DB
        .prepare('UPDATE players SET username=?,game_id=CASE WHEN game_id=? THEN ? ELSE game_id END WHERE id=?')
        .bind(name, row.username, name, id)
        .run();
      return reply({ id });
    }

    fail(400, '未知操作');
  });
