// The Phase 3 start screen (spec §15): the bundle's title, the learner, the streak, what is
// due, the current lesson and its place, one notice line, the session length, the lessons
// marked completed, current or locked, what is installed, and the report and Erase. The
// large button, for today's session, sits in the bar at the bottom.
import { SESSION_SECONDS } from '../engine/progress.js';
import { el, textBlock } from './dom.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A completed lesson offers Redo. The current lesson opens only through the daily session,
// and a locked lesson shows its title and nothing else, so neither is a control.
function lessonList(lessons, onRedo) {
  const items = [];
  let packId = null;
  const multiplePacks = new Set(lessons.map((l) => l.packId)).size > 1;
  for (const lesson of lessons) {
    if (multiplePacks && lesson.packId !== packId) {
      packId = lesson.packId;
      items.push(textBlock('h3', 'pack-heading', lesson.packTitle || lesson.packId));
    }
    const locked = lesson.state === 'locked';
    items.push(
      el(
        'div',
        { class: `lesson lesson-${lesson.state}`, 'data-lesson-id': lesson.lessonId, 'data-state': lesson.state },
        el(
          'div',
          { class: 'lesson-text' },
          el('span', { class: 'lesson-number', text: `Lesson ${lesson.number}` }),
          textBlock('span', 'lesson-title', lesson.title),
          lesson.state === 'current' ? el('span', { class: 'lesson-marker lesson-marker-current', text: 'Current' }) : null,
          lesson.state === 'completed' ? el('span', { class: 'lesson-marker lesson-marker-completed', text: 'Completed' }) : null,
          lesson.needsReview && !locked ? el('span', { class: 'lesson-marker', text: 'Needs review' }) : null,
        ),
        lesson.state === 'completed'
          ? el('button', { type: 'button', class: 'secondary redo', text: 'Redo', 'aria-label': `Redo lesson ${lesson.number}`, onclick: () => onRedo(lesson.lessonId) })
          : null,
      ),
    );
  }
  return items;
}

function installedList(content, onRemove) {
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

// The session length, chosen here until Settings comes: 5, 8, 11 or 14 minutes.
function lengthChoice(current, onLength) {
  return el(
    'div',
    { class: 'length-choice', role: 'group', 'aria-label': 'Session length' },
    SESSION_SECONDS.map((seconds) =>
      el('button', {
        type: 'button',
        class: 'length',
        'aria-pressed': seconds === current ? 'true' : 'false',
        text: `${seconds / 60} min`,
        onclick: () => onLength(seconds),
      }),
    ),
  );
}

const nothingInstalled = (content) => !content.bundle && !content.glossary && !content.track && Object.keys(content.packs).length === 0;

// overview: engine/overview.js's facts for today. notice: what was just done, if anything.
export function startScreen({ progress, content, overview, version, notice, onSession, onRedo, onLength, onImport, onRemove, onSaveReport, onErase }) {
  const empty = nothingInstalled(content);
  const { streak } = progress;
  const due = overview.dueCount === 0 ? 'No reviews due today.' : `${plural(overview.dueCount, 'review', 'reviews')} due today.`;
  const hasLessons = overview.lessons.length > 0;
  return el(
    'section',
    { class: 'screen start-screen' },
    textBlock('h1', 'app-title', (content.bundle && content.bundle.title) || 'Recall'),
    textBlock('p', 'lead learner', `${progress.profile.name} · ${progress.profile.role}`),
    notice ? el('p', { class: 'notice', role: 'status', text: notice }) : null,
    empty ? el('p', { class: 'nothing-installed', text: 'Nothing installed yet.' }) : null,
    hasLessons
      ? el(
          'div',
          { class: 'start-section today' },
          el('p', { class: 'streak-line', text: `Streak ${streak.current}, longest ${streak.longest}, freezes left ${streak.freezesRemaining}.` }),
          el('p', { class: 'due-line', text: due }),
          overview.place
            ? textBlock('p', 'place-line', `Lesson ${overview.place.number} of ${overview.place.total}: ${overview.place.title}`)
            : null,
        )
      : null,
    overview.notice
      ? el('p', { class: `session-notice${overview.noticeKind === 'next-pack' ? ' track-stop' : ''}`, 'data-kind': overview.noticeKind, text: overview.notice })
      : null,
    hasLessons ? el('div', { class: 'start-section' }, el('h2', { text: 'Session length' }), lengthChoice(progress.settings.sessionSeconds, onLength)) : null,
    hasLessons ? el('div', { class: 'start-section' }, el('h2', { text: 'Lessons' }), el('div', { class: 'lesson-list' }, lessonList(overview.lessons, onRedo))) : null,
    empty ? null : el('div', { class: 'start-section' }, el('h2', { text: 'Installed' }), el('ul', { class: 'installed-list' }, installedList(content, onRemove))),
    el(
      'div',
      { class: 'start-section start-actions' },
      overview.action ? el('button', { type: 'button', class: 'secondary', text: 'Import', onclick: onImport }) : null,
      el('button', { type: 'button', class: 'secondary', text: 'Save report now', onclick: onSaveReport }),
      el('button', { type: 'button', class: 'secondary', text: 'Erase this phone', onclick: onErase }),
    ),
    el('p', { class: 'version', text: `Version ${version}` }),
    el(
      'div',
      { class: 'action-bar push' },
      overview.action
        ? el('button', { type: 'button', class: 'primary session-button', 'data-action': overview.action, text: overview.label, onclick: onSession })
        : el('button', { type: 'button', class: 'primary', text: 'Import', onclick: onImport }),
    ),
  );
}
