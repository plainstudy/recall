// The Import screen (spec §9.5): what the file is and what will change, then Install or
// Cancel; or the refusal, in plain words, with nothing changed.
import { el, textBlock } from './dom.js';

const moreText = (n) => (n === 1 ? 'There is 1 more problem.' : `There are ${n} more problems.`);

// A refused file: its first problem and how many more there are.
export function refusalScreen({ fileName, message, more = 0, onClose }) {
  return el(
    'section',
    { class: 'screen import-screen import-refused' },
    el('p', { class: 'card-place', text: 'Import' }),
    textBlock('h1', 'file-name', fileName),
    el('p', { class: 'notice refusal', role: 'alert', text: message }),
    more > 0 ? el('p', { class: 'refusal-more', text: moreText(more) }) : null,
    el('p', { class: 'refusal-after', text: 'Nothing was changed.' }),
    el('div', { class: 'action-bar push' }, el('button', { type: 'button', class: 'primary', text: 'Close', onclick: onClose })),
  );
}

// A file ready to install, or a report ready to restore: the plan's lines and warnings.
export function confirmScreen({ fileName, plan, onConfirm, onCancel }) {
  const restore = plan.kind === 'report';
  return el(
    'section',
    { class: 'screen import-screen import-confirm', 'data-kind': plan.kind },
    el('p', { class: 'card-place', text: 'Import' }),
    textBlock('h1', 'file-name', fileName),
    el('div', { class: 'change-lines' }, plan.lines.map((line) => textBlock('p', 'change-line', line))),
    plan.warnings.length > 0
      ? el(
          'div',
          { class: 'warnings' },
          el('h2', { text: 'Notes' }),
          el('ul', {}, plan.warnings.map((w) => textBlock('li', 'warning', w))),
        )
      : null,
    el(
      'div',
      { class: 'action-bar push' },
      el('button', { type: 'button', class: 'secondary', text: 'Cancel', onclick: onCancel }),
      el('button', { type: 'button', class: 'primary', text: restore ? 'Restore' : 'Install', onclick: onConfirm }),
    ),
  );
}
