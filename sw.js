// v51: only immutable public assets are cached. Pages and API always use network.
const CACHE='lc-v51-2026-09-08';
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lc-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith('/assets/'))return;const network=fetch(e.request);e.waitUntil(network.then(async r=>{if(r.ok)await (await caches.open(CACHE)).put(e.request,r.clone());}).catch(()=>{}));e.respondWith(network.catch(async()=>await caches.match(e.request)||Response.error()));});
