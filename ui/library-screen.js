// The Library (spec §7): the packs in track order, each with its lessons marked completed,
// current or locked. A completed lesson carries a green tick and offers Redo; lessons that
// need review carry the amber marker, and a filter shows only those; a locked lesson shows
// its title and nothing else.
import { el, icon, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

function lessonRow(lesson, onRedo) {
  const open = lesson.state !== 'locked';
  const markers = open
    ? [
        lesson.state === 'completed' ? el('span', { class: 'marker marker-done' }, icon('right'), el('span', { text: 'Completed' })) : null,
        lesson.state === 'current' ? el('span', { class: 'marker marker-current', text: 'Current' }) : null,
        lesson.needsReview ? el('span', { class: 'marker marker-review', text: 'Needs review' }) : null,
      ].filter(Boolean)
    : [];
  return el(
    'div',
    { class: `lesson lesson-${lesson.state}`, 'data-lesson-id': lesson.lessonId, 'data-state': lesson.state },
    el(
      'div',
      { class: 'lesson-text' },
      el('span', { class: 'lesson-number', text: `Lesson ${lesson.number}` }),
      textBlock('span', 'lesson-title', lesson.title),
      markers.length > 0 ? el('span', { class: 'lesson-markers' }, markers) : null,
    ),
    lesson.state === 'completed'
      ? el('button', { type: 'button', class: 'secondary redo', text: 'Redo', 'aria-label': `Redo lesson ${lesson.number}`, onclick: () => onRedo(lesson.lessonId) })
      : null,
  );
}

// lessons: overview.js's lessonStates. trackStop: the line for a track that stops at a pack
// not installed, or null. onlyReview: the filter is on.
export function libraryScreen({ lessons, trackStop = null, onlyReview = false, onFilter, onRedo, onPlace }) {
  const canFilter = lessons.some((l) => l.state !== 'locked' && l.needsReview);
  const filtered = canFilter && onlyReview;
  const shown = filtered ? lessons.filter((l) => l.state !== 'locked' && l.needsReview) : lessons;
  const packs = [];
  for (const lesson of shown) {
    const last = packs[packs.length - 1];
    if (last && last.packId === lesson.packId) last.lessons.push(lesson);
    else packs.push({ packId: lesson.packId, title: lesson.packTitle || lesson.packId, lessons: [lesson] });
  }
  return el(
    'section',
    { class: 'screen place-screen library-screen' },
    el('h1', { class: 'screen-title', text: 'Library' }),
    lessons.length === 0 ? el('p', { class: 'lead', text: 'No lessons installed yet. Import a bundle in Settings.' }) : null,
    canFilter
      ? el('button', { type: 'button', class: 'toggle review-filter', 'aria-pressed': String(filtered), text: 'Needs review only', onclick: onFilter })
      : null,
    packs.map((pack) =>
      el(
        'section',
        { class: 'pack', 'data-pack-id': pack.packId },
        textBlock('h2', 'pack-heading', pack.title),
        el('div', { class: 'lesson-list' }, pack.lessons.map((lesson) => lessonRow(lesson, onRedo))),
      ),
    ),
    trackStop && !filtered ? el('p', { class: 'notice track-stop', text: trackStop }) : null,
    screenFoot('library', onPlace),
  );
}
