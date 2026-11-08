// Start-up: the pack viewer, with the browser's random source and clock, and the service
// worker, registered under the engine version so a new version is a new worker.
import { cryptoRandom, systemClock } from './ui/platform.js';
import { startViewer } from './ui/viewer.js';
import { ENGINE_VERSION } from './version.js';

const root = document.getElementById('app');

try {
  startViewer(root, { version: ENGINE_VERSION, random: cryptoRandom(), clock: systemClock });
} catch {
  const message = document.createElement('p');
  message.className = 'notice';
  message.textContent = 'The app could not start. Close it fully and open it again.';
  root.replaceChildren(message);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`./sw.js?v=${ENGINE_VERSION}`).catch(() => {});
}
