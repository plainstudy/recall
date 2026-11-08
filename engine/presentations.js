// What the engine remembers about each card's presentations: the last order of each of
// its lists, and when it was shown. Held in memory for now. A stored version keeps the
// same two calls, which are asynchronous for that reason.

const copyLists = (lists) =>
  Object.fromEntries(Object.entries(lists || {}).map(([name, order]) => [name, [...order]]));

export function createPresentationMemory(clock) {
  const byCard = new Map();
  return {
    // { lists, shownAt } from the card's last presentation, or null.
    async last(cardId) {
      const entry = byCard.get(String(cardId));
      return entry ? { lists: copyLists(entry.lists), shownAt: entry.shownAt } : null;
    },
    async record(cardId, lists) {
      byCard.set(String(cardId), { lists: copyLists(lists), shownAt: clock.now() });
    },
  };
}
