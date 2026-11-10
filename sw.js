// The service worker. On install it fetches the app's shell past the HTTP cache and keeps
// it under a cache named for the engine version and this worker's scope. It installs only
// when the version.js it fetched names its own version, so no worker ever fills a cache
// with another version's files. It serves the shell from that cache first, so the app
// opens at once on a weak signal or none, and a navigation falls back to the cached page.
// A newer version's worker waits until the app is next started cold, or until the learner
// taps Restart; one that replaces a worker from before 1.0.0, which served from the
// network first, takes over at once. On activate it deletes its older caches for the same
// scope, leaving other sites on the origin alone.
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
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/manrope-latin-600-normal.woff2',
  './fonts/open-sans-latin-400-normal.woff2',
  './fonts/open-sans-latin-600-normal.woff2',
  './engine/assemble.js',
  './engine/card-row.js',
  './engine/cards.js',
  './engine/catalogue.js',
  './engine/confusions.js',
  './engine/days.js',
  './engine/formats.js',
  './engine/glossary.js',
  './engine/ids.js',
  './engine/importing.js',
  './engine/lessons.js',
  './engine/migrate.js',
  './engine/option-order.js',
  './engine/overview.js',
  './engine/presentations.js',
  './engine/progress.js',
  './engine/random.js',
  './engine/report.js',
  './engine/schedule.js',
  './engine/scoring.js',
  './engine/search.js',
  './engine/session.js',
  './engine/streak.js',
  './engine/text.js',
  './engine/validate.js',
  './engine/versions.js',
  './ui/answer-choice.js',
  './ui/answer-cloze.js',
  './ui/answer-hotspot.js',
  './ui/answer-match.js',
  './ui/answer-order.js',
  './ui/app-name.js',
  './ui/card-row.js',
  './ui/card-screen.js',
  './ui/controller.js',
  './ui/dialogs.js',
  './ui/dom.js',
  './ui/figure.js',
  './ui/files.js',
  './ui/first-run.js',
  './ui/glossary-screen.js',
  './ui/history.js',
  './ui/home-screen.js',
  './ui/import-flow.js',
  './ui/library-screen.js',
  './ui/nav-bar.js',
  './ui/platform.js',
  './ui/session-menu.js',
  './ui/session-runner.js',
  './ui/settings-screen.js',
  './ui/storage.js',
  './ui/summary-screen.js',
  './ui/term-screen.js',
  './ui/theme.js',
  './ui/updates.js',
];

// The version a version.js file names, or null.
const versionIn = (text) => {
  const m = /ENGINE_VERSION\s*=\s*'([^']+)'/.exec(text);
  return m ? m[1] : null;
};

// True for a worker from before 1.0.0, or one with no version: those served from the
// network first, so the page already running is the new version's.
function servedFromNetwork(worker) {
  if (!worker) return false;
  const v = new URL(worker.scriptURL).searchParams.get('v');
  return !(v && Number(v.split('.')[0]) >= 1);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const fetched = await Promise.all(
        PAGE.map(async (path) => {
          const request = new Request(path, { cache: 'reload' });
          const response = await fetch(request);
          if (!response.ok) throw new Error(`${path} answered ${response.status}`);
          return [request, response];
        }),
      );
      const [, versionFile] = fetched.find(([request]) => new URL(request.url).pathname.endsWith('/version.js'));
      const served = versionIn(await versionFile.clone().text());
      if (served !== VERSION) throw new Error(`the published version is ${served}, not ${VERSION}`);
      const cache = await caches.open(CACHE);
      await Promise.all(fetched.map(([request, response]) => cache.put(request, response)));
      if (servedFromNetwork(self.registration.active)) await self.skipWaiting();
    })(),
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

// Restart, from Home: the waiting worker takes over.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') {
    const page = (await cache.match('./index.html')) || (await cache.match('./'));
    if (page) return page;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The update check asks the network which version is published, always.
  if (url.searchParams.has('check')) return;
  event.respondWith(fromCache(request));
});
