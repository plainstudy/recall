// Home (spec §7): the bundle's title, or the app's name with no bundle, and the learner's
// name; the streak, the longest and the freezes left, and the reviews due today, as
// scorecards; the current lesson and its place; at most one notice line; and the large
// button, none when there is nothing to study, with the navigation bar below it.
import { el, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

// A label above a figure. Screen readers hear `spoken`, the same in words.
function scorecard(kind, label, figure, spoken) {
  return el(
    'div',
    { class: `scorecard scorecard-${kind}${kind === 'due' && figure > 0 ? ' scorecard-some' : ''}`, role: 'group', 'aria-label': spoken, 'data-value': String(figure) },
    el('p', { class: 'label', 'aria-hidden': 'true', text: label }),
    el('p', { class: 'scorecard-figure', 'aria-hidden': 'true', text: String(figure) }),
  );
}

// title: the heading. learner: the learner's name. streak: the progress's streak.
// overview: engine/overview.js's facts for today. update: null, or { line, onRestart }
// when a new version is ready, which then takes the one notice line. notice: what was just
// done, if anything.
export function homeScreen({ title, learner, streak, overview, update = null, notice = null, onSession, onPlace }) {
  const hasLessons = overview.lessons.length > 0;
  let line = null;
  if (update) {
    line = el(
      'div',
      { class: 'notice notice-update home-notice', 'data-kind': 'update' },
      el('p', { text: update.line }),
      el('button', { type: 'button', class: 'secondary restart', text: 'Restart', onclick: update.onRestart }),
    );
  } else if (overview.notice) {
    line = el('p', { class: 'notice home-notice', 'data-kind': overview.noticeKind, text: overview.notice });
  }
  return el(
    'section',
    { class: 'screen place-screen home-screen' },
    textBlock('h1', 'screen-title app-title', title),
    textBlock('p', 'lead learner', learner),
    notice ? el('p', { class: 'notice notice-done', role: 'status', text: notice }) : null,
    hasLessons
      ? el(
          'div',
          { class: 'scorecards' },
          scorecard('streak', 'Streak', streak.current, `Streak ${streak.current}`),
          scorecard('longest', 'Longest', streak.longest, `Longest ${streak.longest}`),
          scorecard('freezes', 'Freezes left', streak.freezesRemaining, `Freezes left ${streak.freezesRemaining}`),
          scorecard('due', 'Reviews due today', overview.dueCount, overview.dueText),
        )
      : null,
    overview.place
      ? el(
          'div',
          { class: 'panel current-lesson' },
          el('p', { class: 'label', text: 'Current lesson' }),
          el('p', { class: 'place-line', text: `Lesson ${overview.place.number} of ${overview.place.total}` }),
          textBlock('p', 'current-title', overview.place.title),
        )
      : null,
    line,
    screenFoot(
      'home',
      onPlace,
      overview.action
        ? el('button', { type: 'button', class: 'primary session-button', 'data-action': overview.action, text: overview.label, onclick: onSession })
        : null,
    ),
  );
}
