// The phone's Back. The app keeps one history entry per level: Home is level 0, the other
// three places share level 1, so Back from any of them goes Home, and a session or a
// sub-screen, such as a term, Import or a question, goes one level above the screen it
// was opened from. On Back, `onPop(level)` is told the level now shown, and draws it.
export function createHistory(onPop) {
  let depth = 0;
  history.replaceState({ depth: 0 }, '');
  window.addEventListener('popstate', (event) => {
    const level = event.state && Number.isInteger(event.state.depth) ? event.state.depth : 0;
    depth = level;
    onPop(level);
  });
  return {
    get depth() {
      return depth;
    },
    // A new level above the current one.
    push() {
      depth += 1;
      history.pushState({ depth }, '');
    },
    // Back by `levels`, at most to Home. The popstate that follows draws the level.
    back(levels = 1) {
      const n = Math.min(levels, depth);
      if (n > 0) history.go(-n);
    },
  };
}
