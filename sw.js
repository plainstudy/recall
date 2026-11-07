// The service worker. On install it caches the page under a cache named for the engine
// version and this worker's scope; on activate it deletes its older caches for the same
// scope, leaving other sites on the origin alone. It answers from the network when it
// can and from the cache when it cannot.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned';
const SCOPE = self.registration.scope;
const PREFIX = 'engine-';
const CACHE = `${PREFIX}${VERSION}@${SCOPE}`;
const PAGE = [
  './',
  './index.html',
  './app.js',
  './version.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PAGE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(PREFIX) && name.endsWith(`@${SCOPE}`) && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const page = await cache.match('./');
    if (page) return page;
  }
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(() => fromCache(request)));
});
