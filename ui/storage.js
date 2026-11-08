// The phone's storage (spec §9.3). One IndexedDB database, the store of record, and a
// copy of the progress in localStorage. Both are named for the app's scope, as the
// caches are, so other sites on the same origin never collide with them, and Erase
// removes only these.
//
// Stores: `content` (the installed bundle details, glossary, track and packs), `progress`
// (one object), `presentations` (the last option orders, by card id) and `session` (the
// session in progress, from a later version).

import { checkProgress, newerOf } from '../engine/progress.js';

const DB_VERSION = 1;
const PROGRESS_KEY = 'progress';

// The app's scope: the folder its page is served from, as the service worker sees it.
export const appScope = () => new URL('./', location.href).href;

export const storageNames = (scope) => ({ database: `data@${scope}`, mirror: `progress@${scope}` });

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    // Each version's step runs in turn, so a phone several versions behind gets them all.
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        for (const store of ['content', 'progress', 'presentations', 'session']) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab erasing or upgrading the database gets it at once.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The database is open in another tab.'));
  });
}

// Runs `work` in one transaction and resolves once it has committed.
function transaction(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('The change was not saved.'));
    result = work(tx);
  });
}

function readMirror(key) {
  try {
    const text = localStorage.getItem(key);
    if (!text) return null;
    const progress = JSON.parse(text);
    return checkProgress(progress).ok ? progress : null;
  } catch {
    return null;
  }
}

function writeMirror(key, progress) {
  try {
    localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // The mirror is a second copy; the database still holds the first.
  }
}

export async function openStorage(scope = appScope()) {
  const names = storageNames(scope);
  const db = await openDatabase(names.database);

  async function putProgress(progress) {
    await transaction(db, ['progress'], 'readwrite', (tx) => tx.objectStore('progress').put(progress, PROGRESS_KEY));
    writeMirror(names.mirror, progress);
  }

  return {
    names,

    // The installed content: { bundle, glossary, track, packs }.
    async readContent() {
      const requests = await transaction(db, ['content'], 'readonly', (tx) => {
        const store = tx.objectStore('content');
        return { keys: store.getAllKeys(), values: store.getAll() };
      });
      const content = { bundle: null, glossary: null, track: null, packs: {} };
      requests.keys.result.forEach((key, i) => {
        const value = requests.values.result[i];
        if (key.startsWith('pack:')) content.packs[key.slice(5)] = value;
        else if (key in content) content[key] = value;
      });
      return content;
    },

    // The progress: whichever of the stored copy and the mirror was saved later. The
    // stored copy is rebuilt from the mirror when it is missing or older, and the mirror
    // rewritten when it is.
    async readProgress() {
      const stored = await transaction(db, ['progress'], 'readonly', (tx) => tx.objectStore('progress').get(PROGRESS_KEY));
      const kept = stored.result || null;
      const mirrored = readMirror(names.mirror);
      const chosen = newerOf(kept, mirrored);
      if (chosen && chosen !== kept) {
        await transaction(db, ['progress'], 'readwrite', (tx) => tx.objectStore('progress').put(chosen, PROGRESS_KEY));
      }
      if (chosen && chosen !== mirrored) writeMirror(names.mirror, chosen);
      return chosen;
    },

    // A change made outside a session: profile, settings, report marks, restore.
    writeProgress: putProgress,

    // An import or a removal: the content's puts and deletes and the new progress, in one
    // transaction, then the mirror.
    async applyContent(writes, progress) {
      await transaction(db, ['content', 'progress'], 'readwrite', (tx) => {
        const content = tx.objectStore('content');
        for (const [key, value] of writes.put) content.put(value, key);
        for (const key of writes.remove) content.delete(key);
        tx.objectStore('progress').put(progress, PROGRESS_KEY);
      });
      writeMirror(names.mirror, progress);
    },

    // The store behind the remembered option orders.
    presentations: {
      async get(key) {
        const request = await transaction(db, ['presentations'], 'readonly', (tx) => tx.objectStore('presentations').get(key));
        return request.result || null;
      },
      async put(key, value) {
        await transaction(db, ['presentations'], 'readwrite', (tx) => tx.objectStore('presentations').put(value, key));
      },
    },

    // Asks the browser to keep this site's storage. Called at an import until it says yes.
    async persist() {
      try {
        if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
          await navigator.storage.persist();
        }
      } catch {
        // Not every browser offers it; the mirror and the weekly report remain.
      }
    },

    // Removes the database and the mirror, and nothing else of the site.
    async erase() {
      db.close();
      await done(indexedDB.deleteDatabase(names.database));
      try {
        localStorage.removeItem(names.mirror);
      } catch {
        // Nothing to remove.
      }
    },
  };
}
