// Cloze cards: the sentence with its gap, and chips below. A tap puts a chip into the gap,
// a tap on another replaces it, and a second tap on the same chip takes it out.
import { el, markAs, richText } from './dom.js';

const GAP = '___';

export function mountCloze(card, lists, { body, answers, changed }) {
  const byId = new Map(card.chips.map((c) => [String(c.id), c]));
  const prompt = typeof card.prompt === 'string' ? card.prompt : '';
  const at = prompt.indexOf(GAP);
  const before = at === -1 ? `${prompt} ` : prompt.slice(0, at);
  const after = at === -1 ? '' : prompt.slice(at + GAP.length);
  const gap = el('span', { class: 'gap' });
  body.append(el('p', { class: 'prompt cloze-sentence' }, richText(before), gap, richText(after)));

  let chosen = null;
  let locked = false;
  const buttons = new Map();
  const row = el('div', { class: 'chips', role: 'group' });
  for (const id of lists.chips) {
    const button = el(
      'button',
      { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => tap(id) },
      el('span', { class: 'option-text' }, richText(byId.get(id).text)),
    );
    buttons.set(id, button);
    row.append(button);
  }
  answers.append(row);

  function tap(id) {
    if (locked) return;
    chosen = chosen === id ? null : id;
    for (const [other, button] of buttons) button.setAttribute('aria-pressed', String(other === chosen));
    gap.replaceChildren(...(chosen === null ? [] : richText(byId.get(chosen).text)));
    changed();
  }

  return {
    answer: () => (chosen === null ? null : { choice: chosen }),
    // An answer given earlier, shown again as it was chosen.
    restore(given) {
      chosen = given && given.choice != null && buttons.has(String(given.choice)) ? String(given.choice) : null;
      for (const [other, button] of buttons) button.setAttribute('aria-pressed', String(other === chosen));
      gap.replaceChildren(...(chosen === null ? [] : richText(byId.get(chosen).text)));
    },
    reveal(score) {
      locked = true;
      for (const [id, button] of buttons) {
        button.disabled = true;
        if (score.right.includes(id)) markAs(button, 'right');
        else if (id === chosen) markAs(button, 'wrong');
      }
      gap.classList.add(score.correct ? 'gap-right' : 'gap-wrong');
      return null;
    },
  };
}
