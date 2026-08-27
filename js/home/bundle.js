// v45 重写: shared homepage-bundle 缓存 (30s TTL)
// 多个模块 (hero / kart / license / hotel) 共用同一个 fetch 结果

let _bundle = null;
let _bundleTs = 0;
let _bundlePending = null;
const TTL = 30_000;

export async function getBundle(force) {
  if (!force && _bundle && Date.now() - _bundleTs < TTL) return _bundle;
  if (_bundlePending) return _bundlePending;
  _bundlePending = fetch('/api/homepage-bundle', { credentials: 'include' })
    .then(r => r.json())
    .then(d => {
      _bundle = d.bundle || d || {};
      _bundleTs = Date.now();
      return _bundle;
    })
    .finally(() => { _bundlePending = null; });
  return _bundlePending;
}

export function invalidateBundle() {
  _bundle = null;
  _bundleTs = 0;
}
