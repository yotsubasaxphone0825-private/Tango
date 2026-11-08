// マイ単語帳：オフラインでも開けるようにする仕組み（サービスワーカー）
// - アプリ本体（index.html）：ネットにつながるときは最新を取りに行き、つながらないときは保存した分を使う
// - 辞書・アイコン・ライブラリ：一度読んだら端末に保存して、次からはすぐ使う
// - Supabase や AI への通信：ここでは触らない（いつも直接）
const APP = 'tango-app-v1', DATA = 'tango-data-v1';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![APP, DATA].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CDN.includes(url.hostname)) return; // Supabase・AI などはそのまま

  // アプリ本体：ネット優先（更新をすぐ反映）→ だめなら保存した分
  if (same && (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/'))) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // 辞書・アイコン・ライブラリなど：保存した分を優先（なければ取りに行って保存）
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)); }
    return res;
  })));
});
