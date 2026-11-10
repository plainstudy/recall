// Runs a session on the card screens: a daily session or a redo, card by card. It draws
// and records each presentation, measures the time the app is on screen, hands every
// answer to the engine and stores what comes back before moving on.
import { drawPresentation } from '../engine/option-order.js';
import { applyAnswer, applyTeach, completeSession, nextStep } from '../engine/session.js';
import { cardScreen } from './card-screen.js';

// show(screen) puts a screen on the page.
// presentations: the remembered option orders.
// context(): { catalogue, clock, engineVersion, random }, as they stand now.
// store: { writeAnswer(progress, record), finish(progress, session) }, both asynchronous.
// onProgress(progress, session): the progress and session after each stored change.
// onEnd(resume, kind): End session was tapped in a 'daily' session or a 'redo'; resume()
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

    const screen = cardScreen({
      card,
      lists,
      place: `Card ${current.session.index + 1} of ${current.session.plan.length}`,
      onAnswered: ({ answer, score }) => {
        const after = applyAnswer(current, { score, answer, lists, elapsedSec: elapsed() }, context());
        stored = keep(after, current.session.kind === 'daily' ? after.session : null);
        stored.catch(() => {});
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
      onEnd: () => onEnd(() => run === current && show(screen), current.session.kind),
    });
    show(screen);
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
      run = { progress, session, pending: null, counted: session.elapsedSec || 0, since: document.visibilityState === 'hidden' ? null : now() };
      showNext();
    },
    // Leaves the session where it stands, once anything being stored has been. Resolves
    // with { progress, session } as they were stored, or null when no session was running.
    async stop() {
      const left = run;
      run = null;
      if (!left) return null;
      if (left.pending) await left.pending;
      return { progress: left.progress, session: left.session };
    },
    running: () => run !== null,
  };
}
