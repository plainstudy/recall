// A question on a screen of its own: its text above, its answers in the bar at the
// bottom, the main one last. The browser's own dialogs are never used.
import { el } from './dom.js';

// lines: the question, a paragraph each. actions: [{ label, primary, onclick }].
export function questionScreen({ className = '', heading = null, lines, actions }) {
  return el(
    'section',
    { class: `screen question-screen ${className}`.trim() },
    heading ? el('h1', { class: 'question-heading', text: heading }) : null,
    el(
      'div',
      { class: 'question-text' },
      lines.map((text) => el('p', { text })),
    ),
    el(
      'div',
      { class: 'action-bar push' },
      actions.map((a) => el('button', { type: 'button', class: a.primary ? 'primary' : 'secondary', text: a.label, onclick: a.onclick })),
    ),
  );
}
