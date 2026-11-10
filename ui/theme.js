// The theme in use. Phone follows the phone's own light or dark setting, through the
// stylesheet's media query; Night and Day fix it with a data-theme mark on the page, so
// nothing is set inline. The page's theme-color, which colours the phone's own bars,
// follows the background of the theme in use.
import { THEMES } from '../engine/progress.js';
import { readMirroredSettings } from './storage.js';

// The theme-color tags' own values, one for each colour scheme, which Phone uses.
let ownColours = null;

export function applyTheme(theme) {
  const root = document.documentElement;
  const fixed = theme === 'night' || theme === 'day';
  if (fixed) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const tags = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!ownColours) ownColours = tags.map((tag) => tag.content);
  if (fixed) {
    const ink = getComputedStyle(root).getPropertyValue('--ink').trim();
    for (const tag of tags) tag.content = ink;
  } else {
    tags.forEach((tag, i) => {
      tag.content = ownColours[i];
    });
  }
}

// The theme the last saved progress chose, read at once from its second copy, so that a
// fixed theme shows from the first screen.
export function storedTheme() {
  const settings = readMirroredSettings();
  return settings && THEMES.includes(settings.theme) ? settings.theme : 'phone';
}
