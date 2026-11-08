// The Phase 2 start screen (spec §15): the bundle's title, the learner, the lessons in
// the track's order with the current one marked, what is installed, and the report and
// Erase. Import sits in the bar at the bottom.
import { el, textBlock } from './dom.js';

const NEXT_PACK_MISSING = "The next pack in your track isn't installed yet.";

function lessonList(order, currentId, onLesson) {
  const items = [];
  let packId = null;
  const multiplePacks = new Set(order.lessons.map((e) => e.packId)).size > 1;
  order.lessons.forEach((entry, i) => {
    if (multiplePacks && entry.packId !== packId) {
      packId = entry.packId;
      items.push(textBlock('h3', 'pack-heading', entry.packTitle || entry.packId));
    }
    const current = entry.lesson.lessonId === currentId;
    items.push(
      el(
        'button',
        {
          type: 'button',
          class: `lesson${current ? ' lesson-current' : ''}`,
          'data-lesson-id': entry.lesson.lessonId,
          onclick: () => onLesson(entry),
        },
        el('span', { class: 'lesson-number', text: `Lesson ${i + 1}` }),
        textBlock('span', 'lesson-title', entry.lesson.title || ''),
        current ? el('span', { class: 'lesson-marker lesson-marker-current', text: 'Current' }) : null,
        entry.lesson.needsReview ? el('span', { class: 'lesson-marker', text: 'Needs review' }) : null,
      ),
    );
  });
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

const nothingInstalled = (content) => !content.bundle && !content.glossary && !content.track && Object.keys(content.packs).length === 0;

export function startScreen({ progress, content, order, currentId, version, notice, onLesson, onImport, onRemove, onSaveReport, onErase }) {
  const empty = nothingInstalled(content);
  return el(
    'section',
    { class: 'screen start-screen' },
    textBlock('h1', 'app-title', (content.bundle && content.bundle.title) || 'Recall'),
    textBlock('p', 'lead learner', `${progress.profile.name} · ${progress.profile.role}`),
    notice ? el('p', { class: 'notice', role: 'status', text: notice }) : null,
    empty ? el('p', { class: 'nothing-installed', text: 'Nothing installed yet.' }) : null,
    order.lessons.length > 0
      ? el('div', { class: 'start-section' }, el('h2', { text: 'Lessons' }), el('div', { class: 'lesson-list' }, lessonList(order, currentId, onLesson)))
      : null,
    order.stoppedAt ? el('p', { class: 'notice track-stop', text: NEXT_PACK_MISSING }) : null,
    empty ? null : el('div', { class: 'start-section' }, el('h2', { text: 'Installed' }), el('ul', { class: 'installed-list' }, installedList(content, onRemove))),
    el(
      'div',
      { class: 'start-section start-actions' },
      el('button', { type: 'button', class: 'secondary', text: 'Save report now', onclick: onSaveReport }),
      el('button', { type: 'button', class: 'secondary', text: 'Erase this phone', onclick: onErase }),
    ),
    el('p', { class: 'version', text: `Version ${version}` }),
    el('div', { class: 'action-bar push' }, el('button', { type: 'button', class: 'primary', text: 'Import', onclick: onImport })),
  );
}
