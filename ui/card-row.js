// The card row across the top of a card: one control, at least 48 px tall, since each
// square is narrower than a finger. A tap on a square already passed opens that card, or
// the nearest square when the tap falls between two; a square not yet reached opens
// nothing. The row's name says what the squares show, in words. From the keyboard, the
// row opens the last card passed.
import { cardRow, squareAt } from '../engine/card-row.js';
import { el } from './dom.js';

// session: the session record. showing: the place in the plan of the card on screen.
// onOpen(i): open the passed card at place i. onCurrent(): back to the current card, for a
// tap on its square while looking back.
export function cardRowControl(session, showing, { onOpen, onCurrent }) {
  const row = cardRow(session, showing);
  const squares = row.squares.map((s) => el('span', { class: `square square-${s.state}${s.showing ? ' square-showing' : ''}`, 'data-state': s.state }));
  const control = el(
    'button',
    { type: 'button', class: 'card-row', 'aria-label': row.label, 'data-passed': String(row.passed) },
    el('span', { class: 'squares', 'aria-hidden': 'true' }, squares),
  );
  control.addEventListener('click', (event) => {
    if (event.detail === 0) {
      if (row.passed > 0) onOpen(row.passed - 1);
      return;
    }
    const at = squareAt(
      squares.map((square) => {
        const r = square.getBoundingClientRect();
        return [r.left, r.right];
      }),
      event.clientX,
    );
    if (at >= 0 && at < row.passed) onOpen(at);
    else if (at === session.index && showing !== session.index) onCurrent();
  });
  return control;
}
