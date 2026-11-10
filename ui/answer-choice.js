// Choice cards. mcq and desk take one option, like radio buttons; multi and variant take
// any number, like checkboxes. A variant's notes are added only after Check.
import { el, markAs, richText } from './dom.js';

export function mountChoice(card, lists, { answers, changed }) {
  const multiple = card.type === 'multi' || card.type === 'variant';
  const byId = new Map(card.options.map((o) => [String(o.id), o]));
  const chosen = new Set();
  const buttons = new Map();
  let locked = false;

  const group = el('div', { class: `options ${multiple ? 'options-multiple' : 'options-single'}`, role: 'group' });
  for (const id of lists.options) {
    const button = el(
      'button',
      { type: 'button', class: 'option', 'aria-pressed': 'false', onclick: () => toggle(id) },
      el('span', { class: 'option-text' }, richText(byId.get(id).text)),
    );
    buttons.set(id, button);
    group.append(button);
  }
  answers.append(group);

  function toggle(id) {
    if (locked) return;
    if (!multiple) chosen.clear();
    if (multiple && chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    for (const [other, button] of buttons) button.setAttribute('aria-pressed', String(chosen.has(other)));
    changed();
  }

  return {
    answer() {
      if (chosen.size === 0) return null;
      return multiple ? { choices: [...chosen] } : { choice: [...chosen][0] };
    },
    // An answer given earlier, shown again as it was chosen.
    restore(given) {
      chosen.clear();
      for (const id of multiple ? given.choices || [] : [given.choice]) if (buttons.has(String(id))) chosen.add(String(id));
      for (const [other, button] of buttons) button.setAttribute('aria-pressed', String(chosen.has(other)));
    },
    reveal(score) {
      locked = true;
      for (const [id, button] of buttons) {
        button.disabled = true;
        const right = score.right.includes(id);
        if (right) markAs(button, chosen.has(id) || !multiple ? 'right' : 'missed');
        else if (chosen.has(id)) markAs(button, 'wrong');
        const note = byId.get(id).note;
        if (card.type === 'variant' && typeof note === 'string' && note !== '') {
          button.querySelector('.option-text').append(el('span', { class: 'option-note' }, richText(note)));
        }
      }
      return null;
    },
  };
}
