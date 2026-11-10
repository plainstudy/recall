// The card row across the top of a session (spec §7): one square per card of the plan,
// re-asks included. A square fills as its card is done: right, wrong, or read for a card
// with nothing to answer; a square not yet reached is only outlined; and the square of the
// card on screen is marked. Worked out from the session record alone, so it reads the same
// after a restart.
//
// `showing` is the place in the plan of the card on screen: the current card, or a card
// passed and opened again. Returns { squares: [{ state, showing }], passed, label }, where
// state is 'right', 'wrong', 'read' or 'ahead', passed is how many cards are done, and
// label says the same in words, from the card on screen: "Card 9 of 15: 6 right, 1 wrong,
// 2 read".
export function cardRow(session, showing = session.index) {
  const passed = Array.isArray(session.passed) ? session.passed : [];
  const squares = session.plan.map((item, i) => {
    let state = 'ahead';
    if (i < passed.length) state = passed[i].correct === true ? 'right' : passed[i].correct === false ? 'wrong' : 'read';
    return { state, showing: i === showing };
  });
  const count = (state) => squares.filter((s) => s.state === state).length;
  const total = session.plan.length;
  const at = Math.min(showing + 1, total);
  return {
    squares,
    passed: Math.min(passed.length, total),
    label: `Card ${at} of ${total}: ${count('right')} right, ${count('wrong')} wrong, ${count('read')} read`,
  };
}

// The square a tap lands on, from the squares' left and right edges in order: the square
// under it, or the nearest when it falls between two. -1 when there are none.
export function squareAt(edges, x) {
  let best = -1;
  let distance = Infinity;
  edges.forEach(([left, right], i) => {
    const d = x < left ? left - x : x > right ? x - right : 0;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}
