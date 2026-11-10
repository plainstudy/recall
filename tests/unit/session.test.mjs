import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleDaily, assembleRedo } from '../../engine/assemble.js';
import { catalogueOf } from '../../engine/catalogue.js';
import { learnerDay } from '../../engine/days.js';
import { isId } from '../../engine/ids.js';
import { lessonStates } from '../../engine/overview.js';
import { checkProgress } from '../../engine/progress.js';
import { isTestable, scoreAnswer } from '../../engine/scoring.js';
import { MAX_RE_ASKS, applyAnswer, canContinue, completeSession, nextStep, noteTimeOnScreen, reAskPlace, startSession } from '../../engine/session.js';
import { clockAt } from './clock.mjs';
import { contentOf, packOf } from './generated.mjs';
import { at, phoneWith } from './phone.mjs';
import { answerFor, ctxOf, playCard, playToEnd } from './play.mjs';
import { seededRandom } from './seeded.mjs';

const START = '2026-11-15T07:14:00+03:00';
const DAY = '2026-11-15';

// A phone with the next bakery bundle (four lessons), its clock, and a daily session
// assembled and started for it.
function setUp({ seed = 1, stamp = START, sessionSeconds = 660 } = {}) {
  const clock = clockAt(stamp);
  let phone = phoneWith('bundle-bakery-next.json', clock);
  phone = { ...phone, progress: { ...phone.progress, settings: { ...phone.progress.settings, sessionSeconds } } };
  return { clock, phone, random: seededRandom(seed) };
}

function startDaily(phone, clock, random) {
  const day = learnerDay(clock);
  const assembled = assembleDaily({ progress: phone.progress, catalogue: phone.catalogue, day, lastShown: new Map(), random });
  const session = startSession({ kind: 'daily', plan: assembled.plan, day, lengthSec: assembled.lengthSec }, random);
  return { progress: { ...phone.progress, position: { ...phone.progress.position, catchingUp: assembled.catchingUp } }, session };
}

function startRedo(phone, lessonId, clock, random) {
  const plan = assembleRedo(phone.catalogue.lessons.get(lessonId).lesson);
  return { progress: phone.progress, session: startSession({ kind: 'redo', plan, day: learnerDay(clock), lessonId }, random) };
}

// Plays a whole daily session, right or wrong as told, and returns the phone after it.
function dailySession(phone, clock, random, options = {}) {
  const played = playToEnd(startDaily(phone, clock, random), ctxOf(phone, clock, random), options);
  return { ...played, phone: { ...phone, progress: played.progress } };
}

test('a session about to start has an id, its day and length, and nothing passed', () => {
  const { clock, phone, random } = setUp();
  const { session } = startDaily(phone, clock, random);
  assert.equal(isId(session.id), true);
  assert.deepEqual(
    { ...session, id: null, plan: null },
    { id: null, kind: 'daily', day: DAY, lengthSec: 660, lessonId: null, plan: null, index: 0, elapsedSec: 0, passed: [], reAsks: {}, nextBlock: 8, movedUp: [] },
  );
  assert.equal(session.plan.length, 10);
  const redo = startRedo(phone, 'bk_l02', clock, random).session;
  assert.deepEqual([redo.kind, redo.lengthSec, redo.lessonId, redo.plan.length], ['redo', 0, 'bk_l02', 6]);
});

test('a daily session from start to summary: the position moves card by card, the lesson completes and the day counts (test 18)', () => {
  for (const sessionSeconds of [300, 480, 660, 840]) {
    const { clock, phone, random } = setUp({ sessionSeconds });
    const ctx = ctxOf(phone, clock, random);
    let state = startDaily(phone, clock, random);
    const lesson = phone.catalogue.lessons.get('bk_l01').lesson;
    assert.deepEqual(state.session.plan.map((i) => i.cardId), lesson.cards.map((c) => c.cardId));

    lesson.cards.forEach((card, i) => {
      clock.advance(20_000);
      state = playCard(state, ctx, { seconds: (i + 1) * 20 });
      assert.equal(state.step.where.card.cardId, card.cardId);
      const last = i === lesson.cards.length - 1;
      assert.deepEqual(
        [state.progress.position.currentLesson, state.progress.position.currentCardIndex, state.progress.position.lessonsCompleted],
        last ? ['bk_l02', 0, ['bk_l01']] : ['bk_l01', i + 1, []],
        `after card ${i + 1}`,
      );
      assert.equal(state.session.index, i + 1);
      assert.equal(state.session.elapsedSec, (i + 1) * 20);
    });
    assert.deepEqual(nextStep(state.session, phone.catalogue, 200), { done: true, reason: 'end' });
    assert.equal(state.progress.streak.current, 0, 'nothing counts before the summary');
    assert.equal(state.progress.sessionLog[0].completed, false);

    const { progress, summary } = completeSession(state, { elapsedSec: 200 }, ctx);
    assert.deepEqual(summary, {
      kind: 'daily',
      cards: 10,
      answered: 8,
      correct: 8,
      traps: [0, 0],
      movedUp: [],
      streak: { current: 1, longest: 1, freezesRemaining: 2 },
      countedDay: true,
      firstCompleted: true,
    });
    assert.deepEqual(progress.streak, { ...phone.progress.streak, current: 1, longest: 1, lastCountedDay: DAY, countedRun: 1 });
    assert.deepEqual(progress.sessionLog, [
      {
        id: state.session.id,
        day: DAY,
        kind: 'daily',
        lengthSec: sessionSeconds,
        durationSec: 200,
        newCards: 10,
        reviewCards: 0,
        reAsks: 0,
        answered: 8,
        correct: 8,
        traps: [0, 0],
        families: { leavening: [6, 6] },
        completed: true,
      },
    ]);
    // Every atom of the lesson was met for the first time: box 1, due tomorrow.
    assert.equal(Object.keys(progress.atoms).length, 8);
    for (const atom of Object.values(progress.atoms)) {
      assert.deepEqual([atom.box, atom.dueOn, atom.introducedOn, atom.lastPromotedOn, atom.totalSeen], [1, '2026-11-16', DAY, null, 1]);
      assert.match(atom.changedAt, /^2026-11-15T07:1[0-9]:[0-9]{2}\+03:00$/);
    }
    // Six of the lesson's cards name a term of one family; the other two name none.
    assert.deepEqual(progress.families, { leavening: { recent: [1, 1, 1, 1, 1, 1] } });
    assert.deepEqual(checkProgress(progress), { ok: true }, 'what a session writes is valid progress');
  }
});

test("one answer's writes are built as one change: the atom, the family, a confusion, the log entry, the position, the time saved and the record", () => {
  const { clock, phone, random } = setUp();
  const ctx = ctxOf(phone, clock, random);
  let state = startDaily(phone, clock, random);
  state = playCard(state, ctx, { seconds: 12 }); // the first teach card
  assert.deepEqual([state.step.changed, state.progress.position.currentCardIndex, state.session.index], [true, 1, 1]);
  assert.deepEqual(state.session.passed, [{ cardId: 'bk_l01_c01', lists: {}, answer: null, correct: null }]);
  assert.deepEqual(state.progress.sessionLog, [], "a teach card passed writes the position and the record, and no log entry yet");

  const before = structuredClone(state);
  clock.set('2026-11-15T07:15:30+03:00');
  const card = phone.catalogue.cards.get('bk_l01_c02').card;
  const answer = { choice: 'b' }; // Poolish, taken for Levain
  const lists = { options: ['c', 'a', 'b'] };
  const after = applyAnswer(state, { score: scoreAnswer(card, answer), answer, lists, elapsedSec: 31.4 }, ctx);
  assert.deepEqual(state, before, 'nothing given is changed');

  const changed = Object.keys(after.progress).filter((key) => JSON.stringify(after.progress[key]) !== JSON.stringify(before.progress[key]));
  assert.deepEqual(changed.sort(), ['atoms', 'confusions', 'families', 'position', 'savedOn', 'sessionLog']);
  assert.equal(after.progress.savedOn, '2026-11-15T07:15:30+03:00');
  assert.deepEqual(after.progress.atoms, {
    'atom.ingredient.levain': {
      box: 1,
      dueOn: '2026-11-16',
      introducedOn: DAY,
      lastSeenOn: DAY,
      lastPromotedOn: null,
      correctStreak: 0,
      wrongStreak: 1,
      totalSeen: 1,
      totalWrong: 1,
      lastMissedCardId: 'bk_l01_c02',
      trap: false,
      changedAt: '2026-11-15T07:15:30+03:00',
    },
  });
  assert.deepEqual(after.progress.families, { leavening: { recent: [0] } });
  assert.deepEqual(after.progress.confusions, [{ pair: ['levain', 'poolish'], count: 1, countAtLastContrast: 0, lastOn: DAY }]);
  assert.deepEqual(after.progress.position, { currentLesson: 'bk_l01', currentCardIndex: 2, lessonsCompleted: [], catchingUp: false });
  assert.deepEqual(after.progress.sessionLog, [
    {
      id: state.session.id,
      day: DAY,
      kind: 'daily',
      lengthSec: 660,
      durationSec: 31,
      newCards: 2,
      reviewCards: 0,
      reAsks: 0,
      answered: 1,
      correct: 0,
      traps: [0, 0],
      families: { leavening: [1, 0] },
      completed: false,
    },
  ]);

  // The record: one card further, the answer and its list order kept, the re-ask placed.
  assert.equal(after.reAsked, true);
  assert.deepEqual([after.session.index, after.session.elapsedSec, after.session.reAsks], [2, 31, { bk_l01_c02: 1 }]);
  assert.deepEqual(after.session.passed[1], { cardId: 'bk_l01_c02', lists, answer, correct: false });
  assert.equal(after.session.plan.length, state.session.plan.length + 1);
  assert.deepEqual(checkProgress(after.progress), { ok: true });
});

test('a card answered wrong comes back at least three cards later, at a block boundary, before the final desk card, at most twice (test 26)', () => {
  const places = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const { clock, phone, random } = setUp({ seed });
    const ctx = ctxOf(phone, clock, random);
    // The first multiple-choice card is always answered wrong.
    const played = playToEnd(startDaily(phone, clock, random), ctx, { wrong: (card) => card.cardId === 'bk_l01_c02' });
    const cards = played.shown.map((item) => item.cardId);
    const at = cards.map((id, i) => (id === 'bk_l01_c02' ? i : -1)).filter((i) => i >= 0);
    assert.ok(at.length >= 2 && at.length <= 1 + MAX_RE_ASKS, `seed ${seed}: asked ${at.length} times`);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 3, `seed ${seed}: ${at}`);
    assert.deepEqual(played.shown.filter((item) => item.reAsk).map((item) => item.cardId), at.slice(1).map(() => 'bk_l01_c02'));
    for (const i of at.slice(1)) places.add(i);

    // Never between a teach card and its test, and the final desk card is still last.
    const plan = played.session.plan;
    plan.forEach((item, i) => {
      if (item.reAsk) {
        assert.ok(i === 0 || plan[i - 1].block !== item.block);
        assert.ok(i === plan.length - 1 || plan[i + 1].block !== item.block);
      }
      if (item.cardId === 'bk_l01_c03') assert.equal(plan[i + 1].cardId, 'bk_l01_c04', 'the teach card keeps its test');
    });
    assert.equal(plan[plan.length - 1].cardId, 'bk_l01_c08');
    assert.equal(plan[plan.length - 1].final, true);
    assert.equal(plan.filter((item) => item.final).length, 1);

    // A re-ask never promotes, and a wrong re-ask counts like any other wrong answer.
    const atom = played.progress.atoms['atom.ingredient.levain'];
    assert.deepEqual([atom.box, atom.dueOn, atom.totalSeen, atom.totalWrong, atom.wrongStreak], [1, '2026-11-16', at.length, at.length, at.length]);
    const entry = played.progress.sessionLog[0];
    assert.deepEqual([entry.reAsks, entry.newCards, entry.answered, entry.correct], [at.length - 1, 10, 8 + at.length - 1, 7]);
    assert.deepEqual(played.session.reAsks, { bk_l01_c02: at.length - 1 });
  }
  // Over many draws a re-ask lands on every boundary from the fifth card on, up to just
  // before the final desk card, and nowhere else.
  assert.ok(places.has(4) && places.size >= 5, [...places].sort((a, b) => a - b).join(','));
});

test('a re-ask needs a place and, in a daily session, room in the budget; a redo has no budget', () => {
  const { clock, phone, random } = setUp();
  const ctx = ctxOf(phone, clock, random);
  const start = startDaily(phone, clock, random);
  const sessionAt = (index) => ({ ...start.session, index });
  // The plan has ten cards, the last the final desk card. From the eighth card on, no
  // place is three cards later and before the final card.
  const allowed = (index) => {
    const found = new Set();
    for (let seed = 1; seed <= 60; seed++) found.add(reAskPlace(sessionAt(index), phone.catalogue, 0, seededRandom(seed)));
    return [...found].sort((a, b) => a - b);
  };
  assert.deepEqual(allowed(1), [4, 5, 6, 7, 8, 9], 'after the second card: before cards 5 to 10');
  assert.deepEqual(allowed(5), [8, 9]);
  assert.deepEqual(allowed(6), [9], 'just before the final desk card');
  assert.deepEqual(allowed(7), [null]);
  assert.deepEqual(allowed(9), [null], 'the final desk card itself is never asked again');
  // Never between the teach card and its test: the third and fourth cards are one block.
  assert.deepEqual(allowed(0), [4, 5, 6, 7, 8, 9], 'not before the fourth card, which follows its teach card');

  // The budget: the rest of the plan with the re-ask added must fit within B + 120.
  const rest = 25 + 20 + 40 + 30 + 35 + 20 + 20 + 60; // the cards after the second
  assert.notEqual(reAskPlace(sessionAt(1), phone.catalogue, 780 - rest - 20, seededRandom(1)), null, 'exactly B + 120 still fits');
  assert.equal(reAskPlace(sessionAt(1), phone.catalogue, 780 - rest - 19, seededRandom(1)), null);
  // Twice asked again already: no third time.
  assert.equal(reAskPlace({ ...sessionAt(1), reAsks: { bk_l01_c02: 2 } }, phone.catalogue, 0, seededRandom(1)), null);
  assert.notEqual(reAskPlace({ ...sessionAt(1), reAsks: { bk_l01_c02: 1 } }, phone.catalogue, 0, seededRandom(1)), null);

  // In a redo the same places hold, however long it has run.
  const done = at(phone, { currentLesson: 'bk_l02', lessonsCompleted: ['bk_l01'] });
  const redo = startRedo(done, 'bk_l01', clock, random).session;
  const places = new Set();
  for (let seed = 1; seed <= 60; seed++) places.add(reAskPlace({ ...redo, index: 1 }, phone.catalogue, 99_999, seededRandom(seed)));
  assert.deepEqual([...places].sort((a, b) => a - b), [4, 5, 6, 7, 8, 9]);
  assert.equal(reAskPlace({ ...redo, index: 7 }, phone.catalogue, 0, seededRandom(1)), null);
  assert.equal(ctx.catalogue, phone.catalogue);
});

test('the cut-off: a card is never started past B + 120 seconds, and new material is judged a block at a time (§5.1)', () => {
  const { clock, phone, random } = setUp({ sessionSeconds: 300 });
  const ctx = ctxOf(phone, clock, random);
  const start = startDaily(phone, clock, random);
  const step = (index, elapsed, session = start.session) => nextStep({ ...session, index }, phone.catalogue, elapsed);
  // The plan opens with a teach card and its test: 45 seconds as a block. B + 120 is 420.
  assert.equal(step(0, 375).done, false, '375 + 45 is exactly 420');
  assert.deepEqual(step(0, 376), { done: true, reason: 'time' });
  // Inside the block the test is never cut off, so the teach card keeps its test.
  assert.equal(step(1, 9_999).done, false);
  assert.equal(step(1, 9_999).where.card.cardId, 'bk_l01_c02');
  // A card on its own is judged by its own estimate: the match card is 40 seconds.
  assert.equal(step(4, 380).done, false);
  assert.deepEqual(step(4, 381), { done: true, reason: 'time' });
  assert.deepEqual(step(10, 0), { done: true, reason: 'end' });

  // The time running out ends the session at the summary, and the next daily session
  // starts where this one stopped.
  const played = playToEnd(start, ctx, { perCard: 100 });
  assert.equal(played.reason, 'time');
  assert.deepEqual(played.shown.map((i) => i.cardId), ['bk_l01_c01', 'bk_l01_c02', 'bk_l01_c03', 'bk_l01_c04']);
  assert.deepEqual([played.summary.cards, played.summary.countedDay, played.summary.streak.current], [4, true, 1], 'reaching the summary completes it');
  assert.deepEqual([played.progress.position.currentLesson, played.progress.position.currentCardIndex], ['bk_l01', 4]);
  assert.equal(played.progress.sessionLog[0].completed, true);
  const next = startDaily({ ...phone, progress: played.progress }, clock, random);
  assert.equal(next.session.plan.find((i) => i.part === 'new').cardId, 'bk_l01_c05');

  // A redo has no length: it is never cut off.
  const done = at(phone, { currentLesson: 'bk_l02', lessonsCompleted: ['bk_l01'] });
  const redo = startRedo(done, 'bk_l01', clock, random).session;
  assert.equal(nextStep(redo, phone.catalogue, 99_999).done, false);
});

test('a session left part-way keeps its answers, continues the same day from the stored plan, and is discarded on a new day (test 39)', () => {
  const { clock, phone, random } = setUp();
  const ctx = ctxOf(phone, clock, random);
  let state = startDaily(phone, clock, random);
  for (let i = 0; i < 4; i++) state = playCard(state, ctx, { seconds: (i + 1) * 15, wrong: (card) => card.cardId === 'bk_l01_c02' });

  // End session, or the app closed: nothing more is written. The answers are saved, the
  // day doesn't count, and the log entry stays unfinished.
  assert.deepEqual(Object.keys(state.progress.atoms), ['atom.ingredient.levain', 'atom.ingredient.hydration']);
  assert.deepEqual([state.progress.streak.current, state.progress.streak.lastCountedDay], [0, null]);
  assert.deepEqual([state.progress.sessionLog[0].completed, state.progress.sessionLog[0].answered], [false, 2]);
  assert.deepEqual([state.progress.position.currentLesson, state.progress.position.currentCardIndex], ['bk_l01', 4]);

  // The record as the phone stores it, read back later the same day.
  const record = JSON.parse(JSON.stringify(state.session));
  assert.deepEqual(record, state.session, 'the record is plain data');
  clock.set('2026-11-15T21:40:00+03:00');
  assert.equal(canContinue(record, learnerDay(clock)), true);
  clock.set('2026-11-16T03:30:00+03:00');
  assert.equal(canContinue(record, learnerDay(clock)), true, 'before 04:00 it is still the same day');

  // Continuing uses the stored plan from the card it reached; nothing is assembled again.
  const planBefore = structuredClone(record.plan);
  assert.equal(nextStep(record, phone.catalogue, record.elapsedSec).where.card.cardId, record.plan[4].cardId);
  const played = playToEnd({ progress: state.progress, session: record }, ctx);
  const reAsk = planBefore.findIndex((item) => item.reAsk);
  assert.ok(reAsk >= 4, 'the re-ask placed before the break is still in the plan');
  assert.deepEqual(played.session.plan, planBefore, 'the same plan');
  assert.deepEqual(played.shown.map((i) => i.cardId), planBefore.slice(4).map((i) => i.cardId));
  assert.equal(played.session.id, state.session.id);
  // The day counts only once its summary is reached.
  assert.deepEqual([played.summary.countedDay, played.progress.streak.current, played.progress.streak.lastCountedDay], [true, 1, '2026-11-15']);
  assert.equal(played.progress.sessionLog.length, 1, 'one entry for the one session');
  assert.deepEqual([played.progress.sessionLog[0].completed, played.progress.sessionLog[0].newCards, played.progress.sessionLog[0].reAsks], [true, 10, 1]);
  assert.deepEqual(played.progress.position.lessonsCompleted, ['bk_l01']);

  // On a new day the unfinished session is discarded.
  clock.set('2026-11-16T04:00:00+03:00');
  assert.equal(canContinue(record, learnerDay(clock)), false);
  assert.equal(canContinue(null, DAY), false);
  assert.equal(canContinue({ ...record, kind: 'redo' }, DAY), false, 'a redo is never stored or continued');
});

test('the time on screen is saved again when a session is left at End session or by Back (§5.1)', () => {
  const { clock, phone, random } = setUp();
  const ctx = ctxOf(phone, clock, random);
  let state = startDaily(phone, clock, random);

  // Left before its first card is passed: nothing to keep.
  assert.deepEqual(noteTimeOnScreen(state, { elapsedSec: 9 }, ctx).changed, false);

  for (let i = 0; i < 4; i++) state = playCard(state, ctx, { seconds: (i + 1) * 15 });
  assert.equal(state.progress.sessionLog[0].durationSec, 60);
  assert.equal(state.session.elapsedSec, 60);

  // Twenty more seconds on screen before End session: the log entry and the record take them.
  clock.set('2026-11-15T07:20:00+03:00');
  const left = noteTimeOnScreen(state, { elapsedSec: 80.4 }, ctx);
  assert.equal(left.changed, true);
  assert.equal(left.progress.sessionLog[0].durationSec, 80);
  assert.equal(left.session.elapsedSec, 80);
  assert.equal(left.progress.savedOn, '2026-11-15T07:20:00+03:00');
  assert.deepEqual({ ...left.progress, sessionLog: [], savedOn: null }, { ...state.progress, sessionLog: [], savedOn: null }, 'nothing else changes');
  assert.deepEqual({ ...left.session, elapsedSec: 0 }, { ...state.session, elapsedSec: 0 });
  assert.equal(noteTimeOnScreen(left, { elapsedSec: 80 }, ctx).changed, false, 'the same time again changes nothing');

  // Only teach cards passed, with no answer yet: the record still takes the time.
  const teachOnly = { progress: state.progress, session: { ...state.session, id: 'another', index: 1, elapsedSec: 5 } };
  const kept = noteTimeOnScreen(teachOnly, { elapsedSec: 12 }, ctx);
  assert.deepEqual([kept.changed, kept.session.elapsedSec, kept.progress], [true, 12, state.progress]);
});

test('a second session the same day carries on with the lesson, and the day counts once (test 39)', () => {
  const { clock, phone, random } = setUp();
  const first = dailySession(phone, clock, random);
  assert.deepEqual([first.summary.countedDay, first.summary.streak.current, first.summary.firstCompleted], [true, 1, true]);
  clock.advance(600_000);
  const second = dailySession(first.phone, clock, random);
  assert.deepEqual(second.shown.filter((i) => i.part === 'new').map((i) => i.cardId).slice(0, 2), ['bk_l02_c01', 'bk_l02_c02']);
  assert.deepEqual([second.summary.countedDay, second.summary.streak.current, second.summary.firstCompleted], [false, 1, false]);
  assert.deepEqual(second.progress.streak, first.progress.streak, 'the streak counts the day once');
  assert.deepEqual(second.progress.sessionLog.map((e) => [e.kind, e.completed, e.day]), [['daily', true, DAY], ['daily', true, DAY]]);
  assert.notEqual(second.progress.sessionLog[0].id, second.progress.sessionLog[1].id);
  assert.deepEqual(second.progress.position.lessonsCompleted, ['bk_l01', 'bk_l02']);
  // Promotions stay at one per atom per day: lesson 1's atoms, met today, are still in box 1.
  assert.ok(Object.values(second.progress.atoms).every((atom) => atom.box === 1));
});

test('lessons unlock one at a time: completed, current, then locked (test 28)', () => {
  const { clock, phone, random } = setUp();
  const states = (p) => lessonStates(p.catalogue, p.progress.position).map((l) => [l.lessonId, l.state]);
  assert.deepEqual(states(phone), [['bk_l01', 'current'], ['bk_l02', 'locked'], ['pa_l01', 'locked'], ['pa_l02', 'locked']]);
  const first = dailySession(phone, clock, random);
  assert.deepEqual(states(first.phone), [['bk_l01', 'completed'], ['bk_l02', 'current'], ['pa_l01', 'locked'], ['pa_l02', 'locked']]);
  // Part-way through a lesson it is still the current one, and the next is still locked.
  let state = startDaily(first.phone, clock, random);
  state = playCard(state, ctxOf(phone, clock, random));
  state = playCard(state, ctxOf(phone, clock, random));
  assert.deepEqual(states({ ...phone, progress: state.progress }).map((s) => s[1]), ['completed', 'current', 'locked', 'locked']);
  const list = lessonStates(first.phone.catalogue, first.phone.progress.position);
  assert.deepEqual([list[1].number, list[1].title, list[1].needsReview, list[2].packId, list[2].packTitle], [2, 'At the oven', true, 'pastry_basics', 'Pastry basics']);
  // With every lesson completed none is current.
  const all = at(phone, { currentLesson: null, lessonsCompleted: ['bk_l01', 'bk_l02', 'pa_l01', 'pa_l02'] });
  assert.ok(states(all).every((s) => s[1] === 'completed'));
});

test('a redo replays every card in order, never promotes, never moves the position, and does not count for the streak (test 29)', () => {
  const { clock, phone, random } = setUp();
  const first = dailySession(phone, clock, random);
  // The next day every atom of lesson 1 is due. The redo comes before the daily session.
  clock.set('2026-11-16T08:00:00+03:00');
  const before = first.phone.progress;
  const ctx = ctxOf(phone, clock, random);
  const redo = playToEnd(startRedo(first.phone, 'bk_l01', clock, random), ctx, { wrong: (card) => card.cardId === 'bk_l01_c07' });
  const lesson = phone.catalogue.lessons.get('bk_l01').lesson;
  assert.deepEqual(redo.shown.filter((i) => !i.reAsk).map((i) => i.cardId), lesson.cards.map((c) => c.cardId), 'every card, in order');
  assert.ok(redo.shown.every((i) => i.part === 'redo'));
  assert.equal(redo.shown.filter((i) => i.reAsk).length <= 2, true);

  // A correct answer never moves an atom up a box, though each was due.
  for (const [key, atom] of Object.entries(redo.progress.atoms)) {
    if (key === 'atom.technique.timing') continue;
    assert.deepEqual([atom.box, atom.dueOn, atom.lastPromotedOn], [1, '2026-11-16', null], key);
    assert.equal(atom.lastSeenOn, '2026-11-16');
  }
  // A wrong answer sends its atom to box 1, due tomorrow, with that card first next time.
  const missed = redo.progress.atoms['atom.technique.timing'];
  assert.deepEqual([missed.box, missed.dueOn, missed.lastMissedCardId, missed.totalWrong >= 1], [1, '2026-11-17', 'bk_l01_c07', true]);

  assert.deepEqual(redo.progress.position, before.position, 'the position stays');
  assert.deepEqual(redo.progress.streak, before.streak, 'no day is counted');
  assert.deepEqual([redo.summary.kind, redo.summary.streak, redo.summary.countedDay, redo.summary.movedUp], ['redo', null, false, []]);
  const entry = redo.progress.sessionLog[1];
  assert.deepEqual([entry.kind, entry.lengthSec, entry.newCards, entry.completed, entry.day], ['redo', 0, 0, true, '2026-11-16']);
  assert.equal(entry.reviewCards, 10);
  assert.deepEqual(checkProgress(redo.progress), { ok: true });

  // The daily session after it, the same day: the atoms answered in the redo are not
  // promoted today, even by a correct answer, since that may be recall from minutes ago.
  const daily = dailySession({ ...phone, progress: redo.progress }, clock, random);
  assert.equal(daily.summary.streak.current, 2);
  for (const key of ['atom.ingredient.levain', 'atom.ingredient.hydration', 'atom.desk.order-note']) {
    assert.equal(daily.progress.atoms[key].box, 1, key);
  }
  assert.deepEqual(daily.summary.movedUp, []);
});

test('the next day the due atoms come back as reviews, a correct answer moves each up a box, and the streak reaches 2', () => {
  const { clock, phone, random } = setUp();
  const first = dailySession(phone, clock, random, { wrong: (card) => card.cardId === 'bk_l01_c04' });
  assert.equal(first.progress.atoms['atom.ingredient.hydration'].lastMissedCardId, 'bk_l01_c04');
  clock.set('2026-11-16T08:00:00+03:00');
  const second = dailySession(first.phone, clock, random);
  const reviews = second.shown.filter((i) => i.part === 'review').map((i) => i.cardId);
  assert.ok(reviews.length >= 5, `${reviews.length} reviews`);
  assert.ok(reviews.includes('bk_l01_c04'), 'the missed card is the one used');
  assert.ok(second.shown.some((i) => i.part === 'new' && i.cardId.startsWith('bk_l02')));
  // The first answer of the day on a due atom promotes: box 2, due in three days.
  const keys = reviews.map((id) => phone.catalogue.cards.get(id).card.srsKey);
  for (const key of keys) {
    assert.deepEqual([second.progress.atoms[key].box, second.progress.atoms[key].dueOn, second.progress.atoms[key].lastPromotedOn], [2, '2026-11-19', '2026-11-16'], key);
  }
  assert.deepEqual([...second.summary.movedUp].sort(), [...keys].sort());
  assert.equal(second.progress.atoms['atom.ingredient.hydration'].lastMissedCardId, null, 'answered correctly in a later daily session');
  assert.deepEqual([second.summary.streak.current, second.summary.countedDay], [2, true]);
  assert.deepEqual([second.progress.streak.current, second.progress.streak.longest, second.progress.streak.lastCountedDay], [2, 2, '2026-11-16']);
  const entry = second.progress.sessionLog[1];
  assert.equal(entry.reviewCards, second.shown.filter((i) => i.part !== 'new').length);
  assert.equal(entry.newCards, second.shown.filter((i) => i.part === 'new').length);

  // A missed day in between uses a freeze, and the streak carries on.
  clock.set('2026-11-18T08:00:00+03:00');
  const third = dailySession(second.phone, clock, random);
  assert.deepEqual(
    [third.progress.streak.current, third.progress.streak.freezesRemaining, third.progress.streak.freezesUsedOn, third.progress.streak.lastCountedDay],
    [3, 1, ['2026-11-17'], '2026-11-18'],
  );
});

test('an early review and the final desk card of a completed lesson follow the same rules as any answer', () => {
  // A lesson heavy with teach cards, so the ratio guard brings early reviews.
  const pack = packOf([
    { id: 'r1', cards: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'desk'] },
    { id: 'r2', cards: ['teach', 'teach', 'teach', 'mcq', 'teach', 'teach', 'mcq', 'desk'] },
  ]);
  const catalogue = catalogueOf(contentOf(pack));
  const clock = clockAt(START);
  const base = phoneWith([], clock);
  const atoms = {};
  [...catalogue.atoms.keys()].filter((key) => key.includes('r1')).forEach((key, i) => {
    atoms[key] = { box: 3, dueOn: `2026-11-${20 + i}`, introducedOn: '2026-11-01', lastSeenOn: '2026-11-10', lastPromotedOn: null, correctStreak: 1, wrongStreak: 0, totalSeen: 2, totalWrong: 0, lastMissedCardId: null, trap: false, changedAt: null };
  });
  const phone = { ...base, catalogue, progress: { ...base.progress, atoms, position: { currentLesson: 'r2', currentCardIndex: 0, lessonsCompleted: ['r1'], catchingUp: false } } };
  const random = seededRandom(4);
  const played = dailySession(phone, clock, random, { wrong: (card) => card.cardId === 'r1_c02' });
  const early = played.shown.filter((i) => i.part === 'early' && !i.reAsk).map((i) => i.cardId);
  assert.deepEqual(early.sort(), ['r1_c01', 'r1_c02', 'r1_c03', 'r1_c04', 'r1_c05']);
  // Early reviews never promote: answered correctly, box and due day stay.
  for (const id of ['r1_c01', 'r1_c03', 'r1_c04', 'r1_c05']) {
    const key = catalogue.cards.get(id).card.srsKey;
    assert.deepEqual([played.progress.atoms[key].box, played.progress.atoms[key].dueOn], [3, atoms[key].dueOn], id);
  }
  // Answered wrong, an early review demotes like any other.
  const missed = played.progress.atoms[catalogue.cards.get('r1_c02').card.srsKey];
  assert.deepEqual([missed.box, missed.dueOn], [1, '2026-11-16']);
  assert.deepEqual(played.summary.movedUp, []);
  assert.equal(played.progress.sessionLog[0].reviewCards, 5);
  assert.deepEqual(played.progress.position.lessonsCompleted, ['r1', 'r2']);
  assert.deepEqual([played.progress.position.currentLesson, played.progress.position.currentCardIndex], [null, 0], 'the last lesson done');
});

test('traps are counted, each family keeps its last 30 results, and the log keeps its latest 90 entries', () => {
  const { clock, phone, random } = setUp();
  const done = at(phone, { currentLesson: 'pa_l01', lessonsCompleted: ['bk_l01', 'bk_l02'] });
  const ctx = ctxOf(phone, clock, random);
  // Lesson 2 has two trap cards: one cleared, one not.
  const redo = playToEnd(startRedo(done, 'bk_l02', clock, random), ctx, { wrong: (card) => card.cardId === 'bk_l02_c04' });
  const [cleared, shown] = redo.summary.traps;
  assert.equal(cleared, 1);
  assert.ok(shown >= 2, 'the missed trap card, asked again, is shown again');
  assert.equal(redo.progress.atoms['atom.ingredient.poolish'].trap, true);
  assert.equal(redo.progress.atoms['atom.technique.scoring-ear'].trap, false);
  assert.deepEqual(redo.progress.sessionLog[0].traps, [cleared, shown]);
  assert.deepEqual(redo.progress.confusions, [{ pair: ['levain', 'poolish'], count: shown - 1, countAtLastContrast: 0, lastOn: DAY }]);
  const families = redo.progress.sessionLog[0].families;
  assert.deepEqual(Object.keys(families).sort(), ['leavening', 'oven-work', 'shaping']);
  assert.deepEqual(families.leavening, [shown - 1, 0]);

  // Thirty results at most per family, newest last.
  const card = phone.catalogue.cards.get('bk_l02_c04').card;
  let state = { progress: { ...done.progress, families: { leavening: { recent: Array(30).fill(1) } } }, session: startRedo(done, 'bk_l02', clock, random).session };
  state = { ...state, session: { ...state.session, index: 3 } };
  const answer = answerFor(card, false);
  const after = applyAnswer(state, { score: scoreAnswer(card, answer), answer, lists: {}, elapsedSec: 5 }, ctx);
  assert.deepEqual(after.progress.families.leavening.recent, [...Array(29).fill(1), 0]);

  // Ninety entries at most, the oldest dropped.
  const old = Array.from({ length: 90 }, (_, i) => ({ id: `0a1b2c3d-0000-4a00-8a00-${String(i).padStart(12, '0')}`, day: '2026-10-01', kind: 'daily', completed: true, answered: 1, correct: 1, traps: [0, 0], families: {} }));
  const full = { progress: { ...done.progress, sessionLog: old }, session: state.session };
  const logged = applyAnswer(full, { score: scoreAnswer(card, answer), answer, lists: {}, elapsedSec: 5 }, ctx).progress.sessionLog;
  assert.equal(logged.length, 90);
  assert.equal(logged[0].id, old[1].id);
  assert.equal(logged[89].id, state.session.id);
  assert.equal(isTestable(card), true);
});
