// Compatibility action router. All database setup is handled by the API middleware.
import { endpoint, identity, reply, fail } from '../_core/request.js';
import * as signin from './actions/signin.js';
import * as account from './actions/account.js';
import * as passkey from './actions/passkey.js';
import * as adminPlayer from './actions/admin-player.js';
import * as adminDm from './actions/admin-dm.js';
import * as adminPasskeyDebug from './actions/admin-passkey-debug.js';
import { onRequestGet as bundle } from './homepage-bundle.js';
import { resource } from '../_core/resources.js';

/** 旧的 ?action=xxx-manage 名字 → 现在统一的资源名 */
const manage = {
  'hotels-manage': 'hotels',
  'hotel-rooms-manage': 'hotel-rooms',
  'race-tracks-manage': 'race-tracks',
  'license-req-manage': 'license-req',
};

/** 走 account 动作模块的 action 名单 */
const ACCOUNT_ACTIONS = [
  'admin-logout',
  'admin-merge-account',
  'admin-unmerge-account',
  'admin-reset-player-password',
  'admin-enter-password',
  'player-change-password',
];

/** 公告动作 → HTTP 方法；不在表里的公告 action 一律 404 */
const ANNOUNCEMENT_METHODS = {
  'announcement-create': 'POST',
  'announcement-update': 'PATCH',
  'announcement-delete': 'DELETE',
};

export const onRequestGet = (c) =>
  endpoint(async () => {
    const action = new URL(c.request.url).searchParams.get('action');

    if (action === 'signin-status') return signin.onRequestGet(c);

    if (action === 'homepage-bundle') {
      const response = await bundle(c);
      const data = await response.json();
      // 首页只展示在营的酒店和房型，下架的在建站数据里仍然留着
      data.bundle.hotels = data.bundle.hotels.filter((h) => h.is_active);
      data.bundle.rooms = data.bundle.rooms.filter((r) => r.is_active);
      return reply({ bundle: data.bundle });
    }

    if (manage[action]) return resource(manage[action])(c);

    if (action === 'players-list') {
      await identity(c, 'admin');
      const rows = await c.env.DB
        .prepare('SELECT id,username,email,status,emeralds,created_at FROM players ORDER BY id DESC LIMIT 500')
        .all();
      return reply({ items: rows.results });
    }

    if (action === 'unread-summary') {
      // 首页小红点：未登录也要能返回，所以这里 401 不算错误，答一份全 0 的摘要
      let player;
      try {
        player = await identity(c);
      } catch (e) {
        if (e.status === 401) return reply({ logged_in: false, dm: 0, msg_replies: 0, announcement: null });
        throw e;
      }
      const dm = await c.env.DB
        .prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE to_player_id=? AND read_at IS NULL')
        .bind(player.id)
        .first();
      const msgReplies = await c.env.DB
        .prepare('SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL')
        .bind(player.id)
        .first();
      return reply({ logged_in: true, dm: dm.n, msg_replies: msgReplies.n, announcement: null });
    }

    if (!action) {
      await identity(c, 'super');
      return reply({ schema_version: 51 });
    }

    fail(404, '未知功能');
  });

export const onRequestPost = (c) =>
  endpoint(async () => {
    const action = new URL(c.request.url).searchParams.get('action') || '';

    if (['signin', 'signin-status'].includes(action)) return signin.onRequestPost(c);
    if (action.startsWith('passkey-')) return passkey.onRequestPost(c);
    // 这三个从 v45 的 LEGACY 段拆出来后一直没接进来：它们的 action 是
    // `admin-passkey-` 开头，上面那条 `startsWith('passkey-')` 匹配不到，
    // 于是走 /api/init 一律 404「未知功能」。直连 /api/actions/... 却是通的。
    if (action.startsWith('admin-passkey-')) return adminPasskeyDebug.onRequestPost(c);
    if (action.startsWith('admin-dm-')) return adminDm.onRequestPost(c);
    if (action.startsWith('admin-player-')) return adminPlayer.onRequestPost(c);
    if (ACCOUNT_ACTIONS.includes(action)) return account.onRequestPost(c);

    if (action.startsWith('announcement-')) {
      const method = ANNOUNCEMENT_METHODS[action];
      if (!method) fail(404, '未知公告操作');
      // 把旧 action 翻译成统一资源接口的请求；DELETE 不能带 body
      const request = new Request(c.request, {
        method,
        body: method === 'DELETE' ? null : await c.request.text(),
      });
      return resource('announcements')({ ...c, request });
    }

    fail(404, '未知功能');
  });
