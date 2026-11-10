// The navigation bar along the bottom of the four places: Home, the Library, the Glossary
// and Settings, the current one marked. It isn't shown during a session.
import { el, icon } from './dom.js';

export const PLACES = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'settings', label: 'Settings' },
];

export function navBar(current, onPlace) {
  return el(
    'nav',
    { class: 'nav-bar', 'aria-label': 'Places' },
    PLACES.map((place) =>
      el(
        'button',
        {
          type: 'button',
          class: 'nav-place',
          'data-place': place.id,
          'aria-current': place.id === current ? 'page' : null,
          onclick: () => onPlace(place.id),
        },
        icon(place.id),
        el('span', { class: 'nav-label', text: place.label }),
      ),
    ),
  );
}

// The foot of a place: its main action, if it has one, and the navigation bar below it,
// both in the lower third.
export function screenFoot(current, onPlace, ...actions) {
  const shown = actions.flat().filter(Boolean);
  return el('div', { class: 'screen-foot push' }, shown.length > 0 ? el('div', { class: 'action-bar' }, shown) : null, navBar(current, onPlace));
}
