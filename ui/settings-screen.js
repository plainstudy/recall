// Settings (spec §7): the learner's name, which can be changed, and the role, which comes
// from the installed track; the session length; the theme; what is installed, with Remove
// on each pack; the weekly report; About; and Erase this phone. Import, the screen's main
// action, sits in the bar at the bottom, above the navigation bar.
import { PROFILE_MAX, SESSION_SECONDS } from '../engine/progress.js';
import { el, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

const THEME_NAMES = [
  ['phone', 'Phone'],
  ['night', 'Night'],
  ['day', 'Day'],
];

function section(kind, label, ...children) {
  return el('section', { class: `settings-section settings-${kind}` }, el('h2', { text: label }), ...children);
}

// A choice among a few, each a toggle, the chosen one pressed.
function choices(kind, label, options, current, onChoose) {
  return el(
    'div',
    { class: `choices choices-${kind}`, role: 'group', 'aria-label': label },
    options.map(([value, text]) =>
      el('button', { type: 'button', class: 'toggle', 'data-value': String(value), 'aria-pressed': String(value === current), text, onclick: () => onChoose(value) }),
    ),
  );
}

function installedRows(content, onRemove) {
  const rows = [];
  if (content.bundle) rows.push(el('li', { class: 'installed-item' }, textBlock('span', 'installed-name', `Bundle ${content.bundle.title} ${content.bundle.bundleVersion}`)));
  if (content.track) rows.push(el('li', { class: 'installed-item' }, textBlock('span', 'installed-name', `Track ${content.track.title} ${content.track.trackVersion}`)));
  if (content.glossary) rows.push(el('li', { class: 'installed-item' }, el('span', { class: 'installed-name', text: `Glossary ${content.glossary.glossaryVersion}` })));
  const packs = Object.values(content.packs).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.packId).localeCompare(String(b.packId)));
  for (const pack of packs) {
    rows.push(
      el(
        'li',
        { class: 'installed-item installed-pack', 'data-pack-id': pack.packId },
        textBlock('span', 'installed-name', `Pack ${pack.title || pack.packId} ${pack.packVersion}`),
        el('button', { type: 'button', class: 'secondary', text: 'Remove', 'aria-label': `Remove ${pack.title || pack.packId}`, onclick: () => onRemove(pack.packId) }),
      ),
    );
  }
  return rows;
}

// onSaveName(name) resolves with the problem to show, or null once the name is saved.
export function settingsScreen({ progress, content, version, address, notice = null, onSaveName, onLength, onTheme, onImport, onRemove, onSaveReport, onErase, onPlace }) {
  const { profile, settings } = progress;
  const input = el('input', {
    id: 'settings-name',
    type: 'text',
    maxlength: String(PROFILE_MAX),
    autocomplete: 'name',
    autocapitalize: 'words',
    spellcheck: 'false',
    value: profile.name,
    'aria-describedby': 'settings-name-problem',
  });
  const problem = el('p', { id: 'settings-name-problem', class: 'field-problem', 'aria-live': 'polite' });
  const save = el('button', { type: 'button', class: 'secondary save-name', text: 'Save name', disabled: true });
  input.addEventListener('input', () => {
    save.disabled = input.value.trim() === profile.name;
  });
  const submit = async () => {
    const message = await onSaveName(input.value);
    if (!message) return;
    problem.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  const empty = !content.bundle && !content.glossary && !content.track && Object.keys(content.packs).length === 0;

  return el(
    'section',
    { class: 'screen place-screen settings-screen' },
    el('h1', { class: 'screen-title', text: 'Settings' }),
    notice ? el('p', { class: 'notice notice-done', role: 'status', text: notice }) : null,
    section(
      'profile',
      'Profile',
      el('div', { class: 'field' }, el('label', { for: 'settings-name', text: 'Your name' }), input, problem, save),
      el(
        'div',
        { class: 'role' },
        el('p', { class: 'role-label', text: 'Role' }),
        textBlock('p', 'role-value', profile.role || 'Not set'),
      ),
    ),
    section('length', 'Session length', choices('length', 'Session length', SESSION_SECONDS.map((s) => [s, `${s / 60} min`]), settings.sessionSeconds, onLength)),
    section('theme', 'Theme', choices('theme', 'Theme', THEME_NAMES, settings.theme, onTheme)),
    section('installed', 'Installed', empty ? el('p', { class: 'muted-line', text: 'Nothing installed yet.' }) : el('ul', { class: 'installed-list' }, installedRows(content, onRemove))),
    section('report', 'Weekly report', el('button', { type: 'button', class: 'secondary', text: 'Save report now', onclick: onSaveReport })),
    section('about', 'About', el('p', { class: 'version', text: `Version ${version}` }), el('p', { class: 'address', text: address })),
    section('erase', 'This phone', el('button', { type: 'button', class: 'secondary', text: 'Erase this phone', onclick: onErase })),
    screenFoot('settings', onPlace, el('button', { type: 'button', class: 'primary', text: 'Import', onclick: onImport })),
  );
}
