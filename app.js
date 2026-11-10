// Start-up: the theme the learner chose, then the app with the browser's random source and
// clock, and the service worker, registered under the engine version so a new version is a
// new worker. The controller watches for newer versions.
import { startApp } from './ui/controller.js';
import { cryptoRandom, systemClock } from './ui/platform.js';
import { applyTheme, storedTheme } from './ui/theme.js';
import { registerOwnWorker } from './ui/updates.js';
import { ENGINE_VERSION } from './version.js';

applyTheme(storedTheme());

const root = document.getElementById('app');

startApp(root, { version: ENGINE_VERSION, random: cryptoRandom(), clock: systemClock }).catch(() => {
  const message = document.createElement('p');
  message.className = 'notice';
  message.setAttribute('role', 'alert');
  message.textContent = 'The app could not start. Close it fully and open it again.';
  root.replaceChildren(message);
});

registerOwnWorker(ENGINE_VERSION);
