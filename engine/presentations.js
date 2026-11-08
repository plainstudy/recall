// What the engine remembers about each card's presentations: the last order of each of
// its lists, and when it was shown. It is kept in a store passed in, with asynchronous
// `get(key)` and `put(key, value)`: the phone's database in the app, a Map in tests.

const copyLists = (lists) =>
  Object.fromEntries(Object.entries(lists || {}).map(([name, order]) => [name, [...order]]));

export function createPresentations(store, clock) {
  return {
    // { lists, shownAt } from the card's last presentation, or null. shownAt is in
    // milliseconds from the clock.
    async last(cardId) {
      const entry = await store.get(String(cardId));
      return entry ? { lists: copyLists(entry.lists), shownAt: entry.shownAt } : null;
    },
    async record(cardId, lists) {
      await store.put(String(cardId), { lists: copyLists(lists), shownAt: clock.now() });
    },
  };
}

// A store held in memory only.
export function memoryStore() {
  const entries = new Map();
  return {
    get: async (key) => (entries.has(key) ? entries.get(key) : null),
    put: async (key, value) => {
      entries.set(key, value);
    },
  };
}

export const createPresentationMemory = (clock) => createPresentations(memoryStore(), clock);
