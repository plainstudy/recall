// The phone's storage (spec §9.3). One IndexedDB database, the store of record, and a
// copy of the progress in localStorage. Both are named for the app's scope, as the
// caches are, so other sites on the same origin never collide with them, and Erase
// removes only these.
//
// Stores: `content` (the installed bundle details, glossary, track and packs), `progress`
// (one object), `presentations` (the last option orders, by card id) and `session` (one
// record, the unfinished daily session).

import { upgradeProgress } from '../engine/migrate.js';
import { newerOf } from '../engine/progress.js';

const DB_VERSION = 1;
const PROGRESS_KEY = 'progress';
const SESSION_KEY = 'session';

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

// The mirror as it was written, still to be brought up to date and checked.
function readMirror(key) {
  try {
    const text = localStorage.getItem(key);
    const progress = text ? JSON.parse(text) : null;
    return progress !== null && typeof progress === 'object' ? progress : null;
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

  // A change made outside a session. With `clearSession`, the unfinished session's record
  // goes in the same transaction: at a session's summary, and at a restore, which replaces
  // the progress the record belonged to.
  async function putProgress(progress, { clearSession = false } = {}) {
    await transaction(db, clearSession ? ['progress', 'session'] : ['progress'], 'readwrite', (tx) => {
      tx.objectStore('progress').put(progress, PROGRESS_KEY);
      if (clearSession) tx.objectStore('session').delete(SESSION_KEY);
    });
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

    // The progress: whichever of the stored copy and the mirror was saved later. That one
    // copy is brought up to the current schema, so progress saved by an older app gains its
    // new ids once, and both copies are then written from it. The stored copy is rebuilt
    // from the mirror when it is missing or older, and the mirror rewritten when it is.
    // `random` makes the ids a migration adds.
    async readProgress(random) {
      const stored = await transaction(db, ['progress'], 'readonly', (tx) => tx.objectStore('progress').get(PROGRESS_KEY));
      const kept = stored.result || null;
      const mirrored = readMirror(names.mirror);
      const newer = newerOf(kept, mirrored);
      const copies = [newer, newer === kept ? mirrored : kept].filter(Boolean);
      for (const copy of copies) {
        const read = upgradeProgress(copy, random);
        if (!read.ok) continue;
        if (read.migrated || copy !== kept) {
          await transaction(db, ['progress'], 'readwrite', (tx) => tx.objectStore('progress').put(read.progress, PROGRESS_KEY));
        }
        if (read.migrated || copy !== mirrored) writeMirror(names.mirror, read.progress);
        return read.progress;
      }
      // Progress is here but can't be read, as when a newer version of the app wrote it.
      // Starting as a new learner would write over it, so the app doesn't start.
      if (copies.length > 0) throw new Error('The stored progress could not be read.');
      return null;
    },

    // A change made outside a session: profile, settings, report marks, restore, and the
    // end of a session.
    writeProgress: putProgress,

    // One answer, in one transaction: the progress, and the unfinished daily session's
    // record with it. A redo isn't stored, so it passes no record. The mirror is written
    // after a session, not after each answer.
    async writeAnswer(progress, record = null) {
      await transaction(db, record ? ['progress', 'session'] : ['progress'], 'readwrite', (tx) => {
        tx.objectStore('progress').put(progress, PROGRESS_KEY);
        if (record) tx.objectStore('session').put(record, SESSION_KEY);
      });
    },

    // The second copy of the progress, brought up to date when a session is left.
    mirror(progress) {
      writeMirror(names.mirror, progress);
    },

    // The unfinished daily session, or null.
    async readSession() {
      const request = await transaction(db, ['session'], 'readonly', (tx) => tx.objectStore('session').get(SESSION_KEY));
      return request.result || null;
    },

    async clearSession() {
      await transaction(db, ['session'], 'readwrite', (tx) => tx.objectStore('session').delete(SESSION_KEY));
    },

    // An import or a removal: the content's puts and deletes and the new progress, in one
    // transaction, then the mirror. An unfinished session goes with it: its plan may name
    // cards the change has taken away, and its answers are already in the progress.
    async applyContent(writes, progress) {
      await transaction(db, ['content', 'progress', 'session'], 'readwrite', (tx) => {
        const content = tx.objectStore('content');
        for (const [key, value] of writes.put) content.put(value, key);
        for (const key of writes.remove) content.delete(key);
        tx.objectStore('progress').put(progress, PROGRESS_KEY);
        tx.objectStore('session').delete(SESSION_KEY);
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
      // When each card was last shown: Map card id -> the time, for choosing review cards.
      async lastShown() {
        const requests = await transaction(db, ['presentations'], 'readonly', (tx) => {
          const store = tx.objectStore('presentations');
          return { keys: store.getAllKeys(), values: store.getAll() };
        });
        const shown = new Map();
        requests.keys.result.forEach((key, i) => {
          const entry = requests.values.result[i];
          if (entry && typeof entry.shownAt === 'number') shown.set(key, entry.shownAt);
        });
        return shown;
      },
    },

    // Asks the browser to keep this site's storage. Called at an import and at the first
    // completed session, until it says yes.
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
