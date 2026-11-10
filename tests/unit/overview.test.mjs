import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleDaily } from '../../engine/assemble.js';
import { learnerDay } from '../../engine/days.js';
import { OVERVIEW_TEXT, nextReviewDay, overviewOf, reportDue, summaryLines } from '../../engine/overview.js';
import { startSession } from '../../engine/session.js';
import { clockAt } from './clock.mjs';
import { catalogueOf, contentOf, packOf } from './generated.mjs';
import { at, phoneWith } from './phone.mjs';
import { ctxOf, playCard, playToEnd } from './play.mjs';
import { seededRandom } from './seeded.mjs';

const DAY = '2026-11-15';
const clock = () => clockAt('2026-11-15T07:14:00+03:00');

const atomIn = (box, dueOn) => ({ box, dueOn, introducedOn: '2026-11-01', lastSeenOn: '2026-11-10', lastPromotedOn: null, correctStreak: 1, wrongStreak: 0, totalSeen: 2, totalWrong: 0, lastMissedCardId: null, trap: false, changedAt: null });
const withAtoms = (phone, lessonIds, box, dueOn) => {
  const atoms = {};
  for (const [key, entries] of phone.catalogue.atoms) if (entries.some((e) => lessonIds.includes(e.lessonId))) atoms[key] = atomIn(box, dueOn);
  return { ...phone, progress: { ...phone.progress, atoms } };
};
const overview = (phone, more = {}) => overviewOf({ progress: phone.progress, catalogue: phone.catalogue, day: DAY, record: null, ...more });

function daily(phone, c, random) {
  const day = learnerDay(c);
  const { plan, lengthSec } = assembleDaily({ progress: phone.progress, catalogue: phone.catalogue, day, lastShown: new Map(), random });
  return { progress: phone.progress, session: startSession({ kind: 'daily', plan, day, lengthSec }, random) };
}

test("the button's words", () => {
  assert.deepEqual([OVERVIEW_TEXT.start, OVERVIEW_TEXT.continue, OVERVIEW_TEXT.another], ["Start today's session", "Continue today's session", 'Start another session']);
});

test('a new learner with a bundle: the first lesson is current, nothing is due, and the button starts today’s session', () => {
  const phone = phoneWith('bundle-bakery-next.json', clock());
  const o = overview(phone);
  assert.deepEqual(o.lessons.map((l) => l.state), ['current', 'locked', 'locked', 'locked']);
  assert.deepEqual(o.place, { number: 1, total: 4, title: 'Starting a dough' });
  assert.deepEqual([o.dueCount, o.catchingUp, o.notice, o.action, o.label], [0, false, null, 'start', "Start today's session"]);
});

test('with nothing installed, or nothing left to study, there is no session to offer', () => {
  const empty = overview(phoneWith([], clock()));
  assert.deepEqual([empty.lessons, empty.place, empty.dueCount, empty.notice, empty.action, empty.label], [[], null, 0, null, null, null]);
  // A glossary alone gives no lessons either.
  assert.equal(overview(phoneWith('glossary.json', clock())).action, null);
});

test('today’s unfinished session is offered to continue; another day’s is not', () => {
  const c = clock();
  const phone = phoneWith('bundle-bakery-next.json', c);
  const random = seededRandom(2);
  let state = daily(phone, c, random);
  state = playCard(state, ctxOf(phone, c, random));
  const left = { ...phone, progress: state.progress };
  assert.deepEqual([overview(left, { record: state.session }).action, overview(left, { record: state.session }).label], ['continue', "Continue today's session"]);
  assert.equal(overviewOf({ progress: left.progress, catalogue: left.catalogue, day: '2026-11-16', record: state.session }).action, 'start');
  assert.equal(overview(left, { record: null }).action, 'start');
});

test('after the day’s session the button offers another one, until the next day', () => {
  const c = clock();
  const phone = phoneWith('bundle-bakery-next.json', c);
  const random = seededRandom(2);
  const played = playToEnd(daily(phone, c, random), ctxOf(phone, c, random));
  const after = { ...phone, progress: played.progress };
  const o = overview(after);
  assert.deepEqual([o.action, o.label], ['another', 'Start another session']);
  assert.deepEqual(o.lessons.map((l) => l.state), ['completed', 'current', 'locked', 'locked']);
  assert.deepEqual(o.place, { number: 2, total: 4, title: 'At the oven' });
  assert.equal(o.dueCount, 0, 'atoms met today are due tomorrow');
  const next = overviewOf({ progress: after.progress, catalogue: after.catalogue, day: '2026-11-16', record: null });
  assert.deepEqual([next.action, next.dueCount], ['start', 8]);
});

test('the one notice line: catching up first, then the next pack missing, then every lesson done', () => {
  const c = clock();
  // Every lesson done, with a track: reviews carry on.
  let phone = at(phoneWith('bundle-bakery-next.json', c), { currentLesson: null, lessonsCompleted: ['bk_l01', 'bk_l02', 'pa_l01', 'pa_l02'] });
  phone = withAtoms(phone, ['bk_l01', 'bk_l02', 'pa_l01', 'pa_l02'], 2, '2026-11-25');
  for (const [key, entries] of phone.catalogue.atoms) if (entries[0].lessonId === 'bk_l01') phone.progress.atoms[key] = atomIn(2, '2026-11-14');
  let o = overview(phone);
  assert.deepEqual([o.notice, o.place, o.action, o.dueCount], ['Every lesson in your track is done.', null, 'start', 8]);
  // Without a track the line says so in other words.
  let loose = at(phoneWith(['glossary.json', 'pack-bakery.json'], c), { currentLesson: null, lessonsCompleted: ['bk_l01', 'bk_l02'] });
  assert.equal(overview(loose).notice, 'Every installed lesson is done.');
  assert.deepEqual([overview(loose).action, overview(loose).dueCount], ['start', 13], 'atoms of completed lessons that were never met are due at once');
  loose = withAtoms(loose, ['bk_l01', 'bk_l02'], 2, '2026-11-25');
  assert.deepEqual([overview(loose).action, overview(loose).dueCount], ['start', 0], 'with nothing due, early reviews keep the streak');

  // The track lists a pack that isn't installed.
  const waiting = phoneWith(['glossary-next.json', 'pack-bakery-next.json', 'track-bakery-next.json'], c);
  assert.equal(overview(waiting).notice, "The next pack in your track isn't installed yet.");
  assert.equal(overview(waiting).action, 'start', 'the lessons before it are still there to take');

  // Only atoms with a reachable card count as due: these have none.
  const many = at(phoneWith('bundle-bakery-next.json', c), { currentLesson: 'pa_l02', lessonsCompleted: ['bk_l01', 'bk_l02', 'pa_l01'] });
  const loose41 = {};
  for (let i = 0; i < 41; i++) loose41[`atom.made.a${i}`] = atomIn(1, '2026-11-01');
  const met = withAtoms(many, ['bk_l01', 'bk_l02', 'pa_l01'], 2, '2026-11-25');
  assert.equal(overview(met).dueCount, 0);
  assert.equal(overview({ ...met, progress: { ...met.progress, atoms: { ...met.progress.atoms, ...loose41 } } }).dueCount, 0);

  // More than 40 due: catching up takes the line, ahead of the others.
  const lessons = Array.from({ length: 7 }, (_, n) => ({ id: `b${n + 1}`, cards: ['teach', 'mcq', 'cloze', 'mcq', 'cloze', 'mcq', 'cloze', 'mcq', 'desk'] }));
  const catalogue = catalogueOf(contentOf(packOf(lessons)));
  const keys = [...catalogue.atoms.keys()].filter((key) => !key.includes('b7'));
  const backlogged = (count, catchingUp) => ({
    catalogue,
    progress: {
      ...many.progress,
      installed: { ...many.progress.installed, trackId: null },
      position: { currentLesson: 'b7', currentCardIndex: 0, lessonsCompleted: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], catchingUp },
      atoms: Object.fromEntries(keys.map((key, i) => [key, atomIn(1, i < count ? '2026-11-01' : '2026-12-01')])),
    },
  });
  o = overview(backlogged(48, false));
  assert.deepEqual([o.dueCount, o.catchingUp, o.notice, o.action], [48, true, 'Catching up first — 48 to clear.', 'start']);
  o = overview(backlogged(34, true));
  assert.deepEqual([o.catchingUp, o.notice], [true, 'Catching up first — 34 to clear.'], 'still clearing');
  o = overview(backlogged(34, false));
  assert.deepEqual([o.catchingUp, o.notice], [false, null]);
  o = overview(backlogged(18, true));
  assert.deepEqual([o.catchingUp, o.notice], [false, null], 'fewer than 20 due: the switch comes off');
});

test('the next review day is the earliest due day among atoms that can be reviewed', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery-next.json', c), { currentLesson: 'bk_l02', lessonsCompleted: ['bk_l01'] });
  assert.equal(nextReviewDay(phone.progress, phone.catalogue), null);
  phone = withAtoms(phone, ['bk_l01'], 2, '2026-11-20');
  phone.progress.atoms['atom.ingredient.levain'] = atomIn(1, '2026-11-17');
  // An atom whose card hasn't been reached is not scheduled, however early its due day.
  phone.progress.atoms['atom.tool.banneton'] = atomIn(1, '2026-11-01');
  assert.equal(nextReviewDay(phone.progress, phone.catalogue), '2026-11-17');
});

test('a weekly report is due seven days after the last one, or after the first session', () => {
  const base = phoneWith('bundle-bakery.json', clock()).progress;
  assert.equal(reportDue(base, DAY), false, 'no sessions yet');
  const session = (day) => ({ id: '0a1b2c3d-0001-4a00-8a00-000000000001', day, kind: 'daily', completed: true });
  assert.equal(reportDue({ ...base, sessionLog: [session('2026-11-09')] }, DAY), false, 'six days after the first session');
  assert.equal(reportDue({ ...base, sessionLog: [session('2026-11-10'), session('2026-11-08')] }, DAY), true, 'seven days after it');
  assert.equal(reportDue({ ...base, sessionLog: [session('2026-10-01')], reportsSavedOn: ['2026-11-09'] }, DAY), false);
  assert.equal(reportDue({ ...base, sessionLog: [session('2026-10-01')], reportsSavedOn: ['2026-11-01', '2026-11-08'] }, DAY), true);
});

test('the summary’s lines for a daily session and for a redo', () => {
  const c = clock();
  const phone = phoneWith('bundle-bakery-next.json', c);
  const random = seededRandom(2);
  const first = playToEnd(daily(phone, c, random), ctxOf(phone, c, random), { wrong: (card) => card.cardId === 'bk_l01_c08' });
  const lines = (played, day) => summaryLines({ summary: played.summary, progress: played.progress, catalogue: phone.catalogue, day });
  assert.deepEqual(lines(first, DAY), [
    '10 cards seen.',
    '7 of 8 answers correct, 88%.',
    'No atoms moved up a box.',
    'No traps.',
    'Streak 1, longest 1, freezes left 2.',
    'The next review is due tomorrow.',
  ]);

  // The next day: reviews move up a box, and lesson 2 brings its two trap cards.
  c.set('2026-11-16T08:00:00+03:00');
  const after = { ...phone, progress: first.progress };
  const second = playToEnd(daily(after, c, random), ctxOf(phone, c, random), { wrong: (card) => card.cardId === 'bk_l02_c04' });
  const text = lines(second, '2026-11-16');
  assert.match(text[0], /^\d+ cards seen\.$/);
  assert.match(text[1], /^\d+ of \d+ answers correct, \d+%\.$/);
  assert.match(text[2], /^[5-8] atoms moved up a box\.$/);
  assert.match(text[3], /^1 of [2-4] traps cleared\.$/);
  assert.equal(text[4], 'Streak 2, longest 2, freezes left 2.');
  assert.equal(text[5], 'The next review is due tomorrow.');

  // A redo's summary leaves out the atoms moved up and the streak.
  const redoSummary = { kind: 'redo', cards: 6, answered: 5, correct: 5, traps: [2, 2], movedUp: [], streak: null, countedDay: false, firstCompleted: false };
  const redoLines = summaryLines({ summary: redoSummary, progress: second.progress, catalogue: phone.catalogue, day: '2026-11-16' });
  assert.deepEqual(redoLines.slice(0, 3), ['6 cards seen.', '5 of 5 answers correct, 100%.', '2 of 2 traps cleared.']);
  assert.ok(!redoLines.some((line) => line.startsWith('Streak')));

  // Wording for one, and for reviews still due or due later.
  const one = { ...redoSummary, cards: 1, answered: 1, correct: 1, traps: [1, 1] };
  const none = { ...phone.progress, atoms: {} };
  assert.deepEqual(summaryLines({ summary: one, progress: none, catalogue: phone.catalogue, day: DAY }), ['1 card seen.', '1 of 1 answer correct, 100%.', '1 of 1 trap cleared.']);
  assert.deepEqual(summaryLines({ summary: { ...one, answered: 0, correct: 0, traps: [0, 0] }, progress: none, catalogue: phone.catalogue, day: DAY }).slice(1), ['No answers.', 'No traps.']);
  let later = at(phone, { currentLesson: 'bk_l02', lessonsCompleted: ['bk_l01'] });
  later = withAtoms(later, ['bk_l01'], 3, '2026-11-22');
  assert.equal(summaryLines({ summary: one, progress: later.progress, catalogue: phone.catalogue, day: DAY }).at(-1), 'The next review is due on 22 November 2026.');
  later.progress.atoms['atom.ingredient.levain'] = atomIn(1, '2026-11-15');
  assert.equal(summaryLines({ summary: one, progress: later.progress, catalogue: phone.catalogue, day: DAY }).at(-1), '1 review is still due today.');
  later.progress.atoms['atom.ingredient.salt'] = atomIn(1, '2026-11-14');
  assert.equal(summaryLines({ summary: one, progress: later.progress, catalogue: phone.catalogue, day: DAY }).at(-1), '2 reviews are still due today.');
});
