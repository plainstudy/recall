// Runs a session on the card screens: a daily session or a redo, card by card. It draws
// and records each presentation, measures the time the app is on screen, hands every
// answer to the engine and stores what comes back before moving on. Across the top of
// every card run the card row, from which a card already passed opens again read-only,
// and the menu button, whose menu holds End session.
import { drawPresentation } from '../engine/option-order.js';
import { applyAnswer, applyTeach, completeSession, nextStep, noteTimeOnScreen } from '../engine/session.js';
import { cardRowControl } from './card-row.js';
import { cardScreen } from './card-screen.js';
import { el } from './dom.js';
import { menuButton, openSessionMenu } from './session-menu.js';

// show(screen) puts a screen on the page.
// presentations: the remembered option orders.
// context(): { catalogue, clock, engineVersion, random }, as they stand now.
// store: { writeAnswer(progress, record), finish(progress, session) }, both asynchronous.
// onProgress(progress, session): the progress and session after each stored change.
// onEnd(resume, kind): End session was chosen in a 'daily' session or a 'redo'; resume()
//   puts the card back as it was left.
// onSummary({ summary, progress, session }): the summary was reached and stored.
// onFailed(): a change could not be stored.
export function sessionRunner({ show, presentations, context, store, onProgress, onEnd, onSummary, onFailed }) {
  let run = null;

  // Time on screen: seconds counted before, and when the count started again.
  const now = () => context().clock.now();
  const elapsed = () => (run ? run.counted + (run.since === null ? 0 : (now() - run.since) / 1000) : 0);

  document.addEventListener('visibilitychange', () => {
    if (!run) return;
    if (document.visibilityState === 'hidden') {
      run.counted = elapsed();
      run.since = null;
    } else if (run.since === null) {
      run.since = now();
    }
  });

  // The row and the menu button for the card at place `showing` in the plan.
  function topOf(current, showing) {
    return el(
      'div',
      { class: 'session-top' },
      cardRowControl(current.session, showing, {
        onOpen: (i) => lookBack(current, i),
        onCurrent: () => run === current && show(current.screen),
      }),
      menuButton(() => {
        if (run !== current) return;
        const shown = document.querySelector('.card-screen');
        if (shown) openSessionMenu(shown, { onEnd: () => onEnd(() => run === current && show(current.screen), current.session.kind) });
      }),
    );
  }

  // The current card's row again, once its answer is stored: its square fills, and any
  // re-ask placed gets a square of its own.
  function refreshRow(current) {
    const top = current.screen && current.screen.querySelector('.session-top');
    if (top) top.replaceWith(topOf(current, current.session.index - 1));
  }

  // A card already passed, read-only, as it was answered. Previous and Next step through
  // the cards passed, and Back returns to the current card as it was left.
  function lookBack(current, i) {
    if (run !== current) return;
    const done = current.session.passed;
    if (i < 0 || i >= done.length) return;
    const passed = done[i];
    const where = context().catalogue.cards.get(current.session.plan[i].cardId);
    if (!where) return;
    show(
      cardScreen({
        card: where.card,
        lists: passed.lists || {},
        top: topOf(current, i),
        review: {
          heading: `Card ${i + 1}, as it was answered`,
          answer: passed.answer,
          actions: [
            { label: 'Previous', disabled: i === 0, onclick: () => lookBack(current, i - 1) },
            { label: 'Next', disabled: i === done.length - 1, onclick: () => lookBack(current, i + 1) },
            { label: 'Back', primary: true, onclick: () => run === current && show(current.screen) },
          ],
        },
      }),
    );
  }

  async function showNext() {
    const current = run;
    const step = nextStep(current.session, context().catalogue, elapsed());
    if (step.done) {
      await finish(current);
      return;
    }
    const { card } = step.where;
    let lists = {};
    if (!card.unshowable) {
      const previous = await presentations.last(card.cardId);
      lists = drawPresentation(card, previous && previous.lists, context().random);
      await presentations.record(card.cardId, lists);
    }
    if (run !== current) return;

    // What Check started storing, so Continue, or leaving, can wait for it.
    let stored = null;
    let moving = false;
    const keep = (after, record) => {
      const writing = store.writeAnswer(after.progress, record).then(() => {
        current.progress = after.progress;
        current.session = after.session;
        if (run === current) onProgress(after.progress, after.session);
      });
      current.pending = writing.catch(() => {});
      return writing;
    };

    current.screen = cardScreen({
      card,
      lists,
      top: topOf(current, current.session.index),
      onAnswered: ({ answer, score }) => {
        const after = applyAnswer(current, { score, answer, lists, elapsedSec: elapsed() }, context());
        stored = keep(after, current.session.kind === 'daily' ? after.session : null);
        stored.then(() => run === current && refreshRow(current)).catch(() => {});
      },
      onContinue: async () => {
        if (moving) return;
        moving = true;
        try {
          if (stored) await stored;
          else {
            // A card read and passed without an answer.
            const after = applyTeach(current, { elapsedSec: elapsed() }, context());
            if (after.changed) await keep(after, after.session);
            else current.session = after.session;
          }
        } catch {
          if (run === current) {
            run = null;
            onFailed();
          }
          return;
        }
        if (run === current) showNext();
      },
    });
    show(current.screen);
  }

  async function finish(current) {
    const done = completeSession(current, { elapsedSec: elapsed() }, context());
    try {
      await store.finish(done.progress, current.session);
    } catch {
      if (run === current) {
        run = null;
        onFailed();
      }
      return;
    }
    if (run !== current) return;
    run = null;
    onSummary({ summary: done.summary, progress: done.progress, session: current.session });
  }

  return {
    // Starts a session, or continues a stored one from the card it reached.
    start({ progress, session }) {
      run = { progress, session, pending: null, screen: null, counted: session.elapsedSec || 0, since: document.visibilityState === 'hidden' ? null : now() };
      showNext();
    },
    // Leaves the session where it stands, once anything being stored has been, and saves
    // the time on screen again, with the record of a daily session. Resolves with
    // { progress, session } as they were stored, or null when no session was running.
    async stop() {
      const left = run;
      if (!left) return null;
      const seconds = elapsed();
      run = null;
      if (left.pending) await left.pending;
      const noted = noteTimeOnScreen(left, { elapsedSec: seconds }, context());
      if (noted.changed) {
        try {
          await store.writeAnswer(noted.progress, noted.session.kind === 'daily' ? noted.session : null);
          return { progress: noted.progress, session: noted.session };
        } catch {
          // The answers are already stored; only the last seconds on screen are lost.
        }
      }
      return { progress: left.progress, session: left.session };
    },
    running: () => run !== null,
  };
}
