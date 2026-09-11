export function deviceLabel(agent=''){
 const os=/iPhone|iPad/.test(agent)?'iOS':/Android/.test(agent)?'Android':/Windows/.test(agent)?'Windows':/Macintosh/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':'其他设备';
 const browser=/Edg\//.test(agent)?'Edge':/Chrome|CriOS/.test(agent)?'Chrome':/Firefox|FxiOS/.test(agent)?'Firefox':/Safari/.test(agent)?'Safari':'浏览器';return os+' · '+browser;
}
export async function recordSuccessfulLogin(db,request,response){
 const u=new URL(request.url),a=u.searchParams.get('action');
 if(request.method!=='POST'||!response.ok||!(u.pathname==='/api/login'||['passkey-login-finish','passkey-admin-finish','admin-enter-password'].includes(a)))return;
 const token=/lc_session=([^;]+)/.exec(response.headers.get('Set-Cookie')||'')?.[1];if(!token)return;
 const s=await db.prepare('SELECT player_id FROM sessions WHERE token=?').bind(token).first();if(!s?.player_id)return;
 const device=deviceLabel(request.headers.get('User-Agent')||'');
 await db.batch([db.prepare('UPDATE sessions SET device_label=? WHERE token=?').bind(device,token),db.prepare('INSERT INTO login_history(player_id,method,device_label) VALUES(?,?,?)').bind(s.player_id,a?.startsWith('passkey')?'passkey':'password',device),db.prepare('DELETE FROM login_history WHERE player_id=? AND id NOT IN (SELECT id FROM login_history WHERE player_id=? ORDER BY id DESC LIMIT 100)').bind(s.player_id,s.player_id)]);
}
