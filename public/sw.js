// CS2 Manager — service worker.
//
// Strategy:
//   - Install: precache the app shell + static assets (icon, manifest,
//     offline fallback, background music if present).
//   - HTML navigations: network-first with an offline.html fallback.
//   - Everything else (JS/CSS/audio/img): cache-first with background
//     revalidation (stale-while-revalidate).
//   - WebSocket + POST are pass-through — never cached.
//
// Bump CACHE_VERSION when the manifest of precached assets changes so
// old clients purge their stale copies.

const CACHE_VERSION = 'csm-v1';
const RUNTIME_CACHE = 'csm-runtime-v1';

/** Files the app can't start without. Fetched at install time so the
 *  next boot works even fully offline. Others fill the runtime cache
 *  on first request. */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/offline.html',
  '/bgmusic.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Precache everything; ignore individual failures (e.g. missing
      // bgmusic.mp3) so a single 404 doesn't sink the whole install.
      Promise.allSettled(
        PRECACHE_URLS.map((u) => cache.add(u).catch((err) => console.warn('SW precache miss:', u, err))),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Drop old caches from previous versions.
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // don't touch POST/etc
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // only own-origin assets

  // WebSocket upgrades pass through untouched.
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') return;

  const accept = req.headers.get('accept') ?? '';
  const isHtml = req.mode === 'navigate' || accept.includes('text/html');

  if (isHtml) {
    // Network-first for HTML so users always get the freshest shell.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/offline.html') || Response.error()),
        ),
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
