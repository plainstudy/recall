// The pack viewer: open a pack file, list its lessons, play any lesson card by card, and
// end on one line of counts. Answers and option orders are kept in memory only.
import { readPack } from '../engine/cards.js';
import { drawPresentation } from '../engine/option-order.js';
import { createPresentationMemory } from '../engine/presentations.js';
import { summaryLine, tally } from '../engine/scoring.js';
import { cardScreen } from './card-screen.js';
import { el, textBlock } from './dom.js';

const MAX_BYTES = 10 * 1024 * 1024;

export const VIEWER_MESSAGES = {
  tooLarge: 'This file is too large to be a pack.',
  notJson: "This file can't be opened: it isn't JSON.",
};

export function startViewer(root, { version, random, clock }) {
  const memory = createPresentationMemory(clock);
  let pack = null;
  let fileName = '';
  let run = null;
  let inLesson = false;

  // No type filter, so the phone's file picker lists every file.
  const input = el('input', { type: 'file', class: 'file-input', hidden: true, tabindex: '-1' });
  input.addEventListener('change', openFile);
  document.body.append(input);

  // Back from a lesson returns to the lesson list rather than leaving the app.
  window.addEventListener('popstate', () => {
    if (!inLesson) return;
    inLesson = false;
    showLessons();
  });

  function show(screen) {
    root.replaceChildren(screen);
    window.scrollTo(0, 0);
  }

  const openButton = () =>
    el('button', { type: 'button', class: 'primary', text: 'Open a pack file', onclick: () => input.click() });

  function showStart(message) {
    show(
      el(
        'section',
        { class: 'screen start-screen' },
        el('h1', { text: 'Recall' }),
        el('p', { class: 'lead', text: 'Open a pack file to see its lessons.' }),
        message ? el('p', { class: 'notice', role: 'alert', text: message }) : null,
        el('p', { class: 'version', text: `Version ${version}` }),
        el('div', { class: 'action-bar push' }, openButton()),
      ),
    );
  }

  async function openFile() {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) return showStart(VIEWER_MESSAGES.tooLarge);
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return showStart(VIEWER_MESSAGES.notJson);
    }
    const read = readPack(data);
    if (!read.ok) return showStart(read.message);
    pack = read.pack;
    fileName = file.name;
    showLessons();
  }

  function showLessons() {
    show(
      el(
        'section',
        { class: 'screen lessons-screen' },
        textBlock('h1', 'pack-title', pack.title || fileName),
        pack.subtitle ? textBlock('p', 'lead', pack.subtitle) : null,
        el(
          'div',
          { class: 'lesson-list push' },
          pack.lessons.map((lesson, i) =>
            el(
              'button',
              { type: 'button', class: 'lesson', onclick: () => startLesson(lesson) },
              el('span', { class: 'lesson-number', text: `Lesson ${i + 1}` }),
              textBlock('span', 'lesson-title', lesson.title || ''),
              lesson.needsReview ? el('span', { class: 'lesson-marker', text: 'Needs review' }) : null,
            ),
          ),
        ),
        el('div', { class: 'action-bar' }, openButton()),
      ),
    );
  }

  function startLesson(lesson) {
    if (!inLesson) {
      history.pushState({ view: 'lesson' }, '');
      inLesson = true;
    }
    run = { lesson, index: 0, results: [] };
    showCard();
  }

  async function showCard() {
    const current = run;
    const { lesson, index } = current;
    const card = lesson.cards[index];
    const key = card.cardId != null ? String(card.cardId) : `${lesson.lessonId}#${index}`;
    let lists = {};
    if (!card.unshowable) {
      const previous = await memory.last(key);
      lists = drawPresentation(card, previous && previous.lists, random);
      await memory.record(key, lists);
    }
    if (run !== current) return;
    show(
      cardScreen({
        card,
        lists,
        place: `Card ${index + 1} of ${lesson.cards.length}`,
        onAnswered: (r) => current.results.push(r),
        onContinue: () => {
          current.index++;
          if (current.index < lesson.cards.length) showCard();
          else showSummary();
        },
      }),
    );
  }

  function showSummary() {
    const { lesson, results } = run;
    show(
      el(
        'section',
        { class: 'screen summary-screen' },
        el('p', { class: 'card-place', text: 'Lesson finished' }),
        textBlock('h1', 'lesson-heading', lesson.title || ''),
        el('p', { class: 'summary-line', text: summaryLine(tally(lesson.cards.length, results)) }),
        el(
          'div',
          { class: 'action-bar push' },
          el('button', { type: 'button', class: 'primary', text: 'Play again', onclick: () => startLesson(lesson) }),
          el('button', { type: 'button', class: 'secondary', text: 'Lessons', onclick: backToLessons }),
        ),
      ),
    );
  }

  function backToLessons() {
    if (inLesson) history.back();
    else showLessons();
  }

  showStart();
}
