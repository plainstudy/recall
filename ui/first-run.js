// First run (spec §7): the app's name, then the learner's name, the only typing in the app
// apart from search, then Import your bundle or Skip. The role comes from the bundle's
// track, so it isn't asked.
import { PROFILE_MAX, checkName } from '../engine/progress.js';
import { APP_NAME } from './app-name.js';
import { questionScreen } from './dialogs.js';
import { el } from './dom.js';

// The name. onDone({ name }) once it is given.
export function profileScreen({ version, onDone }) {
  const input = el('input', {
    id: 'profile-name',
    type: 'text',
    maxlength: String(PROFILE_MAX),
    autocomplete: 'name',
    autocapitalize: 'words',
    spellcheck: 'false',
    'aria-describedby': 'profile-name-problem',
  });
  const problem = el('p', { id: 'profile-name-problem', class: 'field-problem', 'aria-live': 'polite' });
  const submit = () => {
    const check = checkName(input.value);
    problem.textContent = check.problem || '';
    if (!check.ok) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    onDone({ name: check.name });
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  return el(
    'section',
    { class: 'screen first-run' },
    el('h1', { class: 'screen-title', text: APP_NAME }),
    el('p', { class: 'lead', text: 'Your progress is kept on this phone. Start with your name.' }),
    el('div', { class: 'field' }, el('label', { for: 'profile-name', text: 'Your name' }), input, problem),
    el('p', { class: 'version', text: `Version ${version}` }),
    el('div', { class: 'action-bar push' }, el('button', { type: 'button', class: 'primary', text: 'Continue', onclick: submit })),
  );
}

// After the name: the bundle, now or later.
export function bundleQuestionScreen({ onImport, onSkip }) {
  return questionScreen({
    className: 'first-run first-run-import',
    heading: 'Your bundle',
    lines: ['Import the bundle you were sent: it holds your lessons, the glossary and your track.', 'You can also skip this and import it later, in Settings.'],
    actions: [
      { label: 'Skip', onclick: onSkip },
      { label: 'Import your bundle', primary: true, onclick: onImport },
    ],
  });
}
