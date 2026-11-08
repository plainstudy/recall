// Plays a lesson card by card, as Session 1's viewer did, and ends on one line of counts.
// Answers are kept in memory only; option orders are remembered in the store passed in,
// so a card shown again draws a new order even after the app restarts.
import { drawPresentation } from '../engine/option-order.js';
import { summaryLine, tally } from '../engine/scoring.js';
import { cardScreen } from './card-screen.js';
import { el, textBlock } from './dom.js';

// show(screen) puts a screen on the page. onLessons returns to the list.
export function lessonPlayer({ show, presentations, random, onLessons }) {
  let run = null;

  async function showCard() {
    const current = run;
    const { lesson, index } = current;
    const card = lesson.cards[index];
    let lists = {};
    if (!card.unshowable) {
      const previous = await presentations.last(card.cardId);
      lists = drawPresentation(card, previous && previous.lists, random);
      await presentations.record(card.cardId, lists);
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
          el('button', { type: 'button', class: 'primary', text: 'Play again', onclick: () => play(lesson) }),
          el('button', { type: 'button', class: 'secondary', text: 'Lessons', onclick: onLessons }),
        ),
      ),
    );
  }

  function play(lesson) {
    run = { lesson, index: 0, results: [] };
    showCard();
  }

  return {
    play,
    stop() {
      run = null;
    },
  };
}
