// The service worker. On install it caches the app's shell under a cache named for the
// engine version and this worker's scope, fetching each file past the HTTP cache so two
// versions never mix. On activate it deletes its older caches for the same scope, leaving
// other sites on the origin alone. It answers from the network when it can and from the
// cache when it cannot.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned';
const SCOPE = self.registration.scope;
const PREFIX = 'engine-';
const CACHE = `${PREFIX}${VERSION}@${SCOPE}`;

// Every file the app loads. A unit test fails if one is missing or doesn't exist.
const PAGE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './version.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './engine/assemble.js',
  './engine/cards.js',
  './engine/catalogue.js',
  './engine/days.js',
  './engine/formats.js',
  './engine/glossary.js',
  './engine/ids.js',
  './engine/importing.js',
  './engine/lessons.js',
  './engine/migrate.js',
  './engine/option-order.js',
  './engine/presentations.js',
  './engine/progress.js',
  './engine/random.js',
  './engine/report.js',
  './engine/schedule.js',
  './engine/scoring.js',
  './engine/text.js',
  './engine/validate.js',
  './engine/versions.js',
  './ui/answer-choice.js',
  './ui/answer-cloze.js',
  './ui/answer-hotspot.js',
  './ui/answer-match.js',
  './ui/answer-order.js',
  './ui/card-screen.js',
  './ui/controller.js',
  './ui/dialogs.js',
  './ui/dom.js',
  './ui/figure.js',
  './ui/files.js',
  './ui/first-run.js',
  './ui/import-flow.js',
  './ui/platform.js',
  './ui/player.js',
  './ui/start-screen.js',
  './ui/storage.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PAGE.map((path) => new Request(path, { cache: 'reload' }))))
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
