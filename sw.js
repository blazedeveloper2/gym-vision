// Offline support. App files are network-first (updates show up right away;
// the cache is only a fallback). Versioned MediaPipe files and models are
// cache-first because their URLs never change.
const VERSION = '0.2.0';
const SHELL_CACHE = `gv-shell-${VERSION}`;
const CDN_CACHE = 'gv-cdn-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/settings.js',
  './js/engine.js',
  './js/camera.js',
  './js/geometry.js',
  './js/voice.js',
  './js/render/gl.js',
  './js/render/overlay.js',
  './js/body/parts.js',
  './js/body/measure.js',
  './js/body/history.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/home.js',
  './js/ui/scan.js',
  './js/ui/exercise.js',
  './js/ui/measure-ui.js',
  './js/ui/settings-ui.js',
  './js/exercises/index.js',
  './js/exercises/base.js',
  './js/exercises/pushup.js',
  './js/exercises/squat.js',
  './js/exercises/lunge.js',
  './js/exercises/curl.js',
  './js/exercises/press.js',
  './js/exercises/lateral.js',
  './js/exercises/jacks.js',
  './js/exercises/plank.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        const stale = (key.startsWith('gv-shell-') && key !== SHELL_CACHE) || key.startsWith('gth-');
        if (stale) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
}
