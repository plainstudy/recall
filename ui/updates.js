// Updates (spec §9.1). The app's own worker is registered under its version. After start,
// and when the app comes back on screen, at most once an hour and only when online, the
// app asks the network which version is published. A different one is registered as a new
// worker, which fetches and keeps its own shell, then waits. Home offers it with Restart;
// otherwise the next cold start takes it. Nothing here ever reloads the page unless the
// learner tapped Restart.
const CHECK_EVERY_MS = 60 * 60 * 1000;
const RESTART_WAIT_MS = 3000;

const versionOf = (worker) => (worker ? new URL(worker.scriptURL).searchParams.get('v') : null);

// The worker for this version, registered when there is none yet, or when the one running
// is another version's and nothing newer is on its way.
export async function registerOwnWorker(version) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const settled = registration && registration.active && (versionOf(registration.active) === version || registration.waiting || registration.installing);
    if (!settled) await navigator.serviceWorker.register(`./sw.js?v=${version}`);
  } catch {
    // Without a worker the app still runs; it only needs the network to open.
  }
}

// onReady(version) runs once, when a newer version's worker is installed and waiting.
// Returns { check, restart }.
export function watchForUpdates({ version, onReady }) {
  let lastCheck = 0;
  let ready = null;

  function announce(worker) {
    const next = versionOf(worker);
    if (!ready && next && next !== version) {
      ready = worker;
      onReady(next);
    }
  }

  async function check() {
    if (!('serviceWorker' in navigator) || !navigator.onLine || ready) return;
    if (lastCheck !== 0 && Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.waiting) {
        announce(registration.waiting);
        return;
      }
      const response = await fetch(`version.js?check=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const published = /ENGINE_VERSION\s*=\s*'([^']+)'/.exec(await response.text());
      if (!published || published[1] === version) return;
      const next = await navigator.serviceWorker.register(`./sw.js?v=${published[1]}`);
      if (next.waiting) {
        announce(next.waiting);
        return;
      }
      const installing = next.installing;
      if (installing) {
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') announce(installing);
        });
      }
    } catch {
      // Offline, or the new version refused to install: the next check tries again.
    }
  }

  // Switches to the waiting version and starts it.
  function restart() {
    if (!ready) return;
    let done = false;
    const reload = () => {
      if (done) return;
      done = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    ready.postMessage({ type: 'skip-waiting' });
    setTimeout(reload, RESTART_WAIT_MS);
  }

  return { check, restart };
}
