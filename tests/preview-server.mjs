// Local-only browser test fixtures. Never connects to production or reads .dev.vars.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const player = { id: 7, username: '本地测试市民', status: 'active', email: 'test@example.invalid', avatar_emoji: '👤', emeralds: 100, created_at: '2026-08-01T00:00:00Z' };
const bundle = { hotels: [{ id: 1, name: '测试酒店', is_active: 1 }], rooms: [{ id: 2, hotel_id: 1, name: '测试双人房', capacity: 2, beds: '双床', price_per_night: 20, is_active: 1 }], tracks: [], licenseReqs: [], announcements: [], playerCount: 1 };
let counts = {}, writes = [];
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const json = (d, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(d)); };
  if (u.pathname === '/__test/results') return json({ counts, writes });
  if (u.pathname.startsWith('/api/')) {
    counts[req.method + ' ' + req.url] = (counts[req.method + ' ' + req.url] || 0) + 1;
    if (req.method !== 'GET') { let body='';for await(const chunk of req)body+=chunk;writes.push({method:req.method,url:req.url,body});return json({ok:true,id:11,nights:1}); }
    if (u.pathname === '/api/login') return json({ok:true,role:'super',combined:true,user:{id:1,username:'本地测试管理员',role:'super'},player});
    if (u.pathname === '/api/homepage-bundle') return json({ok:true,bundle});
    if (u.pathname === '/api/admin/dashboard') return json({ok:true,players:{pending:3,active:4},messages:{unread:2},bookings:{pending:1},license:{pending:2},kart:{pending:5},circuit:{pending:6}});
    if (u.pathname === '/api/leaderboard') return json({ok:true,entries:[{rank:1,username:'<b>测试市民</b>',avatar_emoji:'👤',score:3}]});
    if (u.pathname === '/api/notifications') return json({ok:true,unread_count:1,notifications:[{id:1,type:'message_reply',title:'本地测试通知',body:'这是回归测试数据',created_at:'2026-09-08 12:00:00',link:'profile.html',read_at:null}]});
    if (u.pathname === '/api/social' && u.searchParams.get('action')==='profile') return json({ok:true,profile:player,stats:{}});
    if (u.pathname === '/api/init' && u.searchParams.get('action')==='signin-status') return json({ok:true,signed_today:false,current_streak:0,today:'2026-09-08',recent:[]});
    return json({ok:true,announcements:[],messages:[],items:[],tickets:[],players:[],admins:[],bookings:[],conversations:[],times:[],questions:[],subscriptions:[],wrong_book:[],struggles:[],counts:{}});
  }
  const rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);
  // Allow only public static extensions; no repository/config/secret files are served.
  if (!/\.(?:html|css|js|json|svg|jpg|png|woff2)$/.test(rel) || rel.split('/').some(p=>p.startsWith('.'))) {res.writeHead(404);return res.end('Not found');}
  const f=path.resolve(root,'.'+rel);
  if(!f.startsWith(root)||!fs.existsSync(f)){res.writeHead(404);return res.end('Not found');}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'};
  res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);
});
server.listen(8873,'127.0.0.1',()=>console.log('Local fixture preview: http://127.0.0.1:8873 (no production access)'));
