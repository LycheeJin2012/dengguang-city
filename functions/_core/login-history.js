/** 从 User-Agent 里粗略认设备：认不准就退到「其他设备 / 浏览器」，不做精细识别 */
export function deviceLabel(agent = '') {
  const os = /iPhone|iPad/.test(agent) ? 'iOS'
    : /Android/.test(agent) ? 'Android'
    : /Windows/.test(agent) ? 'Windows'
    : /Macintosh/.test(agent) ? 'macOS'
    : /Linux/.test(agent) ? 'Linux'
    : '其他设备';

  // Edge 必须排在 Chrome 前面：Edg 的 UA 里同时带 Chrome
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Chrome|CriOS/.test(agent) ? 'Chrome'
    : /Firefox|FxiOS/.test(agent) ? 'Firefox'
    : /Safari/.test(agent) ? 'Safari'
    : '浏览器';

  return os + ' · ' + browser;
}

/** 算作「登录成功」的 action —— 与 shouldAudit 里排除的鉴权动作是同一批入口 */
const loginActions = ['passkey-login-finish', 'passkey-admin-finish', 'admin-enter-password'];

/**
 * 登录成功后记一条设备历史。
 *
 * 三步合成一次 batch：给会话打上设备标签、写入 login_history、
 * 然后按玩家裁掉第 100 条以后的旧记录。少任何一步都会留下不一致的中间态。
 *
 * 记不到就静默返回 —— 这条链路是安全历史的补充，不该因为它把登录搞失败。
 */
export async function recordSuccessfulLogin(db, request, response) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (
    request.method !== 'POST' ||
    !response.ok ||
    !(url.pathname === '/api/login' || loginActions.includes(action))
  ) {
    return;
  }

  // 登录响应会下发 lc_session；从 Set-Cookie 里取回来反查会话
  const token = /lc_session=([^;]+)/.exec(response.headers.get('Set-Cookie') || '')?.[1];
  if (!token) return;

  const session = await db.prepare('SELECT player_id FROM sessions WHERE token=?').bind(token).first();
  if (!session?.player_id) return;

  const device = deviceLabel(request.headers.get('User-Agent') || '');

  await db.batch([
    // 1) 会话上留一份设备标签，账号安全页直接读
    db.prepare('UPDATE sessions SET device_label=? WHERE token=?').bind(device, token),
    // 2) 写入历史。admin-enter-password 走密码，passkey-* 走通行密钥
    db
      .prepare('INSERT INTO login_history(player_id,method,device_label) VALUES(?,?,?)')
      .bind(session.player_id, action?.startsWith('passkey') ? 'passkey' : 'password', device),
    // 3) 每个玩家只留最近 100 条
    db
      .prepare(
        'DELETE FROM login_history WHERE player_id=? AND id NOT IN (SELECT id FROM login_history WHERE player_id=? ORDER BY id DESC LIMIT 100)'
      )
      .bind(session.player_id, session.player_id),
  ]);
}
