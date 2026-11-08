// Match cards: two columns, each in its own order. Tap an item in one column, then its
// partner in the other; both then carry the same pair mark. Tapping a paired item undoes
// the pair. The rows line up, so the two columns read across.
import { el, markAs, richText } from './dom.js';

export function mountMatch(card, lists, { answers, changed }) {
  const byId = new Map(card.pairs.map((p) => [String(p.id), p]));
  const buttons = { left: new Map(), right: new Map() };
  const partner = { left: new Map(), right: new Map() };
  const marks = new Map(); // left id -> pair mark
  let active = null; // { side, id }
  let locked = false;

  const grid = el('div', { class: 'match', role: 'group' });
  const rows = Math.max(lists.left.length, lists.right.length);
  for (let i = 0; i < rows; i++) {
    for (const side of ['left', 'right']) {
      const id = lists[side][i];
      if (id === undefined) {
        grid.append(el('span', { class: 'match-empty' }));
        continue;
      }
      const button = el(
        'button',
        { type: 'button', class: `match-item match-${side}`, 'aria-pressed': 'false', onclick: () => tap(side, id) },
        el('span', { class: 'option-text' }, richText(byId.get(id)[side])),
      );
      buttons[side].set(id, button);
      grid.append(button);
    }
  }
  answers.append(grid);

  const other = (side) => (side === 'left' ? 'right' : 'left');

  function lowestFreeMark() {
    const used = new Set(marks.values());
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  function unpair(side, id) {
    const leftId = side === 'left' ? id : partner.right.get(id);
    const rightId = partner.left.get(leftId);
    partner.left.delete(leftId);
    partner.right.delete(rightId);
    marks.delete(leftId);
  }

  function tap(side, id) {
    if (locked) return;
    if (partner[side].has(id)) {
      unpair(side, id);
      active = null;
    } else if (active && active.side === side && active.id === id) {
      active = null;
    } else if (active && active.side === other(side)) {
      const leftId = side === 'left' ? id : active.id;
      const rightId = side === 'left' ? active.id : id;
      partner.left.set(leftId, rightId);
      partner.right.set(rightId, leftId);
      marks.set(leftId, lowestFreeMark());
      active = null;
    } else {
      active = { side, id };
    }
    render();
    changed();
  }

  function setMark(button, mark) {
    const old = button.querySelector('.pair-mark');
    if (old) old.remove();
    if (mark !== null) button.prepend(el('span', { class: 'pair-mark', text: String(mark) }));
    button.classList.toggle('paired', mark !== null);
  }

  function render() {
    for (const side of ['left', 'right']) {
      for (const [id, button] of buttons[side]) {
        const leftId = side === 'left' ? id : partner.right.get(id);
        setMark(button, leftId !== undefined && marks.has(leftId) ? marks.get(leftId) : null);
        button.setAttribute('aria-pressed', String(Boolean(active && active.side === side && active.id === id)));
      }
    }
  }

  return {
    answer() {
      if (partner.left.size !== lists.left.length) return null;
      return { pairs: lists.left.map((leftId) => [leftId, partner.left.get(leftId)]) };
    },
    reveal(score) {
      locked = true;
      for (const side of ['left', 'right']) for (const button of buttons[side].values()) button.disabled = true;
      for (const pair of score.pairs) {
        markAs(buttons.left.get(pair.left), pair.ok ? 'right' : 'wrong');
        markAs(buttons.right.get(pair.right), pair.ok ? 'right' : 'wrong');
      }
      if (score.correct) return null;
      return el(
        'div',
        { class: 'answer-key' },
        el('p', { class: 'answer-key-title', text: 'Correct pairs' }),
        el(
          'ul',
          { class: 'answer-key-list' },
          lists.left.map((id) => el('li', {}, richText(byId.get(id).left), ' — ', richText(byId.get(id).right))),
        ),
      );
    },
  };
}
