// A small static file server for the screen tests. It serves the repository root, the
// way the published site does, and has no dependencies.
// Run: node tests/server.mjs [port]
//
// For the update tests only, /__versions/<name>/ serves the repository again as if it were
// published there, with three additions:
//   /__versions/<name>/__set?v=<version>  from now on, version.js there names <version>
//   /__versions/<name>/__old-worker.js    a worker that serves from the network first, as
//                                         every version before 1.0.0 did
//   /__versions/<name>/__old-page         a page that installs that worker
// Each name keeps its own version, so tests running side by side don't meet.
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || 4370);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const OLD_WORKER = [
  "self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));",
  "self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));",
  "self.addEventListener('fetch', (event) => { if (event.request.method === 'GET') event.respondWith(fetch(event.request)); });",
  '',
].join('\n');

const OLD_PAGE = [
  '<!doctype html><meta charset="utf-8"><title>Before 1.0.0</title>',
  '<script>navigator.serviceWorker.register("./__old-worker.js?v=0.3.0");</script>',
  '',
].join('\n');

const versions = new Map();

function send(res, type, body) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let version = null;
    const test = /^\/__versions\/([\w-]+)(\/.*)$/.exec(path);
    if (test) {
      const [, name, rest] = test;
      if (rest === '/__set') {
        versions.set(name, new URL(req.url, 'http://localhost').searchParams.get('v'));
        res.writeHead(204).end();
        return;
      }
      if (rest === '/__old-worker.js') return send(res, TYPES['.js'], OLD_WORKER);
      if (rest === '/__old-page') return send(res, TYPES['.html'], OLD_PAGE);
      path = rest;
      version = versions.get(name) || null;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(ROOT, `.${path}`);
    if (!file.startsWith(ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    let body = await readFile(file);
    if (version && path === '/version.js') body = Buffer.from(body.toString('utf8').replace(/ENGINE_VERSION = '[^']+'/, `ENGINE_VERSION = '${version}'`));
    send(res, TYPES[extname(file)] || 'application/octet-stream', body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving the repository at http://127.0.0.1:${PORT}/`);
});
