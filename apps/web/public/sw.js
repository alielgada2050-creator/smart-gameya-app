/*
 * Service worker: makes Jamiyati installable and opens instantly/offline on desktop and phones.
 * It caches ONLY the app shell (HTML, hashed JS/CSS, icons, manifest). It never caches or intercepts
 * /api/ or /files/ — balances, receipts, notes and chat always come from the server.
 */
const VERSION = 'sg-shell-v4';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return; // private data: network only

  // Navigations: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
