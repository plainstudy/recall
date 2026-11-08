// First run (spec §7): name, then role, then Import your bundle or Skip. The only typing
// in the app, apart from search.
import { PROFILE_MAX, checkProfile } from '../engine/progress.js';
import { questionScreen } from './dialogs.js';
import { el } from './dom.js';

function field(id, label, autocomplete) {
  const input = el('input', {
    id,
    type: 'text',
    maxlength: String(PROFILE_MAX),
    autocomplete,
    autocapitalize: 'words',
    spellcheck: 'false',
    'aria-describedby': `${id}-problem`,
  });
  const problem = el('p', { id: `${id}-problem`, class: 'field-problem', 'aria-live': 'polite' });
  const wrap = el('div', { class: 'field' }, el('label', { for: id, text: label }), input, problem);
  return { wrap, input, problem };
}

// The name and role. onDone({ name, role }) once both are given.
export function profileScreen({ version, onDone }) {
  const name = field('profile-name', 'Your name', 'name');
  const role = field('profile-role', 'Your role', 'organization-title');
  const submit = () => {
    const check = checkProfile({ name: name.input.value, role: role.input.value });
    for (const [key, f] of [['name', name], ['role', role]]) {
      const message = check.problems[key] || '';
      f.problem.textContent = message;
      if (message) f.input.setAttribute('aria-invalid', 'true');
      else f.input.removeAttribute('aria-invalid');
    }
    if (!check.ok) {
      (check.problems.name ? name.input : role.input).focus();
      return;
    }
    onDone(check.profile);
  };
  name.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') role.input.focus();
  });
  role.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  return el(
    'section',
    { class: 'screen first-run' },
    el('h1', { text: 'Recall' }),
    el('p', { class: 'lead', text: 'Your progress is kept on this phone. Start with your name and role.' }),
    name.wrap,
    role.wrap,
    el('p', { class: 'version', text: `Version ${version}` }),
    el('div', { class: 'action-bar push' }, el('button', { type: 'button', class: 'primary', text: 'Continue', onclick: submit })),
  );
}

// After the profile: the bundle, now or later.
export function bundleQuestionScreen({ onImport, onSkip }) {
  return questionScreen({
    className: 'first-run first-run-import',
    heading: 'Your bundle',
    lines: ['Import the bundle you were sent: it holds your lessons, the glossary and your track.', 'You can also skip this and import it later.'],
    actions: [
      { label: 'Skip', onclick: onSkip },
      { label: 'Import your bundle', primary: true, onclick: onImport },
    ],
  });
}
