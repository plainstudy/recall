// The test page: four lines that show whether install and offline use work.
import { ENGINE_VERSION } from './version.js';

const show = (id, text) => {
  document.getElementById(id).textContent = text;
};

const standalone = window.matchMedia('(display-mode: standalone)');
const showInstalled = () =>
  show('installed', standalone.matches || window.navigator.standalone === true ? 'yes' : 'no');
const showNetwork = () => show('network', navigator.onLine ? 'online' : 'offline');

show('version', ENGINE_VERSION);
showInstalled();
showNetwork();
standalone.addEventListener('change', showInstalled);
window.addEventListener('online', showNetwork);
window.addEventListener('offline', showNetwork);

show('worker', 'no');
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`./sw.js?v=${ENGINE_VERSION}`).catch(() => show('worker', 'no'));
  navigator.serviceWorker.ready.then(() => show('worker', 'yes'));
}
