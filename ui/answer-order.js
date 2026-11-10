// Order cards: one list. Tapping an item moves it up into the next numbered slot, so the
// sequence builds at the top; tapping a placed item sends it back, and the later ones
// move up a slot. The slot numbers are the answer, not labels.
import { el, markAs, richText } from './dom.js';

export function mountOrder(card, lists, { answers, changed }) {
  const byId = new Map(card.items.map((item) => [String(item.id), item]));
  const placed = [];
  let locked = false;
  const buttons = new Map();
  for (const id of lists.items) {
    buttons.set(
      id,
      el(
        'button',
        { type: 'button', class: 'item', 'aria-pressed': 'false', onclick: () => tap(id) },
        el('span', { class: 'option-text' }, richText(byId.get(id).text)),
      ),
    );
  }
  const list = el('div', { class: 'order-list', role: 'group' });
  answers.append(list);

  function setSlot(button, slot) {
    const old = button.querySelector('.slot');
    if (old) old.remove();
    if (slot !== null) button.prepend(el('span', { class: 'slot', text: String(slot) }));
    button.setAttribute('aria-pressed', String(slot !== null));
  }

  function render() {
    const focused = document.activeElement;
    const pool = lists.items.filter((id) => !placed.includes(id));
    const nodes = placed.map((id, k) => {
      setSlot(buttons.get(id), k + 1);
      return buttons.get(id);
    });
    if (placed.length > 0 && pool.length > 0) nodes.push(el('hr', { class: 'order-divider' }));
    for (const id of pool) {
      setSlot(buttons.get(id), null);
      nodes.push(buttons.get(id));
    }
    list.replaceChildren(...nodes);
    if (focused instanceof HTMLElement && list.contains(focused)) focused.focus({ preventScroll: true });
  }

  function tap(id) {
    if (locked) return;
    const at = placed.indexOf(id);
    if (at === -1) placed.push(id);
    else placed.splice(at, 1);
    render();
    changed();
  }

  render();

  return {
    answer: () => (placed.length === lists.items.length ? { sequence: [...placed] } : null),
    // An answer given earlier, its sequence shown again as it was built.
    restore(given) {
      placed.splice(0, placed.length, ...(given.sequence || []).map(String).filter((id) => buttons.has(id)));
      render();
    },
    reveal(score) {
      locked = true;
      score.sequence.forEach(({ id, ok }) => {
        const button = buttons.get(id);
        button.disabled = true;
        markAs(button, ok ? 'right' : 'wrong');
      });
      if (score.correct) return null;
      return el(
        'div',
        { class: 'answer-key' },
        el('p', { class: 'answer-key-title', text: 'Correct order' }),
        el(
          'ol',
          { class: 'answer-key-list' },
          score.expected.map((id) => el('li', {}, richText(byId.get(id).text))),
        ),
      );
    },
  };
}
