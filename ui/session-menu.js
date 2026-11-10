// The session menu: a button at the end of the card row opens a short menu at the bottom of
// the screen, within thumb reach, holding End session, which asks first on a screen of its
// own, and Close. A tap outside it, or Escape, closes it too.
import { el, icon } from './dom.js';

export function menuButton(onOpen) {
  return el('button', { type: 'button', class: 'menu-button', 'aria-label': 'Session menu', 'aria-haspopup': 'dialog', onclick: onOpen }, icon('menu'));
}

// Opens the menu over `screen`. onEnd() runs when End session is chosen.
export function openSessionMenu(screen, { onEnd }) {
  const opener = screen.querySelector('.menu-button');
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Session menu' });
  const close = () => {
    backdrop.remove();
    sheet.remove();
    if (opener && opener.isConnected) opener.focus();
  };
  sheet.append(
    el('button', {
      type: 'button',
      class: 'secondary sheet-item',
      text: 'End session',
      onclick: () => {
        close();
        onEnd();
      },
    }),
    el('button', { type: 'button', class: 'primary sheet-item', text: 'Close', onclick: close }),
  );
  backdrop.addEventListener('click', close);
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  screen.append(backdrop, sheet);
  sheet.querySelector('button').focus();
  return close;
}
