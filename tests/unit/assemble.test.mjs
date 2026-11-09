import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OVERRUN_SECONDS, REVIEW_SHARE, assembleDaily, assembleRedo, planSeconds } from '../../engine/assemble.js';
import { blocksOf, catalogueOf, estimateOf } from '../../engine/catalogue.js';
import { currentLessonId } from '../../engine/lessons.js';
import { isTestable } from '../../engine/scoring.js';
import { backlog, cardForAtom, dueList, notYetDue } from '../../engine/schedule.js';
import { clockAt } from './clock.mjs';
import { contentOf, generatedPack, generatedProgress, packOf } from './generated.mjs';
import { at, installOn, phoneWith } from './phone.mjs';
import { seededRandom } from './seeded.mjs';

const DAY = '2026-11-15';
const clock = () => clockAt('2026-11-15T07:14:00+03:00');
const LENGTHS = [300, 480, 660, 840];

const atomIn = (box, dueOn, more = {}) => ({
  box,
  dueOn,
  introducedOn: '2026-11-01',
  lastSeenOn: '2026-11-10',
  lastPromotedOn: null,
  correctStreak: 1,
  wrongStreak: 0,
  totalSeen: 2,
  totalWrong: 0,
  lastMissedCardId: null,
  trap: false,
  changedAt: null,
  ...more,
});

const withLength = (progress, sessionSeconds) => ({ ...progress, settings: { ...progress.settings, sessionSeconds } });
const ids = (plan, part) => plan.filter((item) => !part || item.part === part).map((item) => item.cardId);
const assemble = (phone, { seed = 1, day = DAY, lastShown = new Map() } = {}) =>
  assembleDaily({ progress: phone.progress, catalogue: phone.catalogue, day, lastShown, random: seededRandom(seed) });

// Every atom of these lessons, in progress with the same box and due day.
function atomsOf(catalogue, lessonIds, box, dueOn) {
  const atoms = {};
  for (const [key, entries] of catalogue.atoms) if (entries.some((e) => lessonIds.includes(e.lessonId))) atoms[key] = atomIn(box, dueOn);
  return atoms;
}

// ----------------------------------------------------------------- the invariants (§5.2)

// Checks one assembled session against everything the spec promises of it, whatever the
// state it was assembled from.
function checkSession(result, { progress, catalogue, day, lastShown }, label) {
  const { plan } = result;
  const budget = progress.settings.sessionSeconds;
  const position = progress.position;
  const card = (item) => catalogue.cards.get(item.cardId).card;
  const of = (part) => plan.filter((item) => item.part === part);
  const fresh = of('new');
  const reviews = of('review');
  const early = of('early');
  const desk = of('desk');

  // Every card is in the content, and none comes twice.
  assert.equal(new Set(plan.map((i) => i.cardId)).size, plan.length, `${label}: a card comes once`);

  // Test 3: the estimate stays within B + 120 seconds.
  assert.equal(result.estimateSec, planSeconds(plan, catalogue), label);
  assert.ok(result.estimateSec <= budget + OVERRUN_SECONDS, `${label}: ${result.estimateSec}s for a budget of ${budget}s`);
  assert.equal(result.lengthSec, budget, label);

  // The backlog switch, and no new material while it is on (test 7).
  const due = dueList(progress, catalogue, day);
  assert.equal(result.dueCount, due.length, label);
  assert.equal(result.catchingUp, backlog(due.length, position.catchingUp), label);
  if (result.catchingUp) assert.equal(fresh.length, 0, `${label}: no new material while catching up`);

  // New material: the current lesson's cards from the current card on, in order, a whole
  // number of blocks, and never the next lesson.
  const lessonId = currentLessonId(catalogue.order, position);
  const lesson = lessonId == null ? null : catalogue.lessons.get(lessonId).lesson;
  if (fresh.length > 0) {
    assert.ok(lesson, label);
    const expected = lesson.cards.slice(position.currentCardIndex, position.currentCardIndex + fresh.length).map((c) => c.cardId);
    assert.deepEqual(fresh.map((i) => i.cardId), expected, `${label}: the lesson's cards in order`);
    const blocks = blocksOf(lesson.cards, position.currentCardIndex);
    const ends = new Set(blocks.map((b) => b[b.length - 1] - position.currentCardIndex + 1));
    assert.ok(ends.has(fresh.length), `${label}: whole blocks only`);
    assert.equal(result.lessonId, lessonId, label);
  }
  const freshAtoms = new Set(fresh.map(card).filter(isTestable).map((c) => c.srsKey));
  const reachesEnd = lesson && fresh.length > 0 && position.currentCardIndex + fresh.length === lesson.cards.length;
  const newLeft = Boolean(lesson) && position.currentCardIndex < lesson.cards.length;

  // Test 27: a review never comes between a teach card and the test after it. Cards of one
  // block sit side by side.
  plan.forEach((item, i) => {
    if (i > 0 && plan[i - 1].block === item.block) assert.equal(plan[i - 1].part, item.part, `${label}: one block, one part`);
    if (item.part === 'new' && !isTestable(card(item)) && i + 1 < plan.length && fresh[fresh.length - 1] !== item) {
      assert.equal(plan[i + 1].part, 'new', `${label}: ${item.cardId} is followed by its test`);
      assert.equal(plan[i + 1].block, item.block, label);
    }
    if (item.part !== 'new') assert.ok(isTestable(card(item)), `${label}: ${item.cardId} is testable`);
  });
  assert.deepEqual(plan.map((i) => i.block), [...plan.map((i) => i.block)].sort((a, b) => a - b), `${label}: blocks are numbered in order`);

  // Reviews: at most 20, one card each, taken from the front of the due list, leaving out
  // any atom a card of the new material tests; each the card §4.3 chooses.
  assert.ok(reviews.length <= 20, label);
  const dueLeft = due.filter((d) => !freshAtoms.has(d.key));
  const reviewKeys = reviews.map((i) => card(i).srsKey).sort();
  assert.deepEqual(reviewKeys, dueLeft.slice(0, reviews.length).map((d) => d.key).sort(), `${label}: the first atoms of the due list`);
  for (const d of dueLeft.slice(0, reviews.length)) {
    assert.ok(ids(plan, 'review').includes(cardForAtom(d.atom, d.entries, lastShown).card.cardId), `${label}: the card for ${d.key}`);
  }
  if (dueLeft.length > 0) assert.ok(reviews.length >= 1, `${label}: at least one review whenever one is due`);

  // The 40% share, in the longer sessions with new material left and no backlog.
  const reviewSeconds = reviews.reduce((sum, i) => sum + estimateOf(card(i)), 0);
  const shared = budget !== 300 && !result.catchingUp && newLeft;
  if (shared && reviews.length > 1) assert.ok(reviewSeconds <= REVIEW_SHARE * budget, `${label}: reviews take ${reviewSeconds}s of ${budget}s`);

  // One review per atom: no atom twice outside the new material, and none that it tests.
  const outside = [...reviews, ...early, ...desk].map((i) => card(i).srsKey);
  assert.equal(new Set(outside).size, outside.length, `${label}: one card per atom`);
  for (const key of outside) assert.ok(!freshAtoms.has(key), `${label}: ${key} is left to the new material`);

  // Early reviews: atoms not yet due, the soonest due first.
  const later = notYetDue(progress, catalogue, day);
  const deskKey = desk.length > 0 ? card(desk[0]).srsKey : null;
  const taken = new Set([...freshAtoms, ...reviewKeys]);
  const candidates = later.filter((d) => !taken.has(d.key) && d.key !== deskKey);
  assert.deepEqual(early.map((i) => card(i).srsKey).sort(), candidates.slice(0, early.length).map((d) => d.key).sort(), `${label}: the soonest due first`);

  // Test 4: at least 60% testable, wherever an atom is left to add.
  const testable = plan.filter((i) => isTestable(card(i))).length;
  if (plan.length > 0 && testable < 0.6 * plan.length) {
    assert.equal(candidates.length, early.length, `${label}: under 60% only when no atom is left to add`);
  }

  // The final desk card: the lesson's own when the new material reaches its end; otherwise
  // one from a completed lesson whose atom isn't in the session, whenever there is one.
  const finals = plan.filter((i) => i.final);
  assert.ok(finals.length <= 1, label);
  if (finals.length === 1) {
    assert.equal(finals[0], plan[plan.length - 1], `${label}: the final desk card is last`);
    assert.equal(card(finals[0]).type, 'desk', label);
  }
  const ownDesk = reachesEnd && lesson.cards[lesson.cards.length - 1].type === 'desk';
  if (ownDesk) {
    assert.equal(finals[0].cardId, lesson.cards[lesson.cards.length - 1].cardId, `${label}: the lesson's own desk card`);
    assert.equal(desk.length, 0, label);
  } else {
    const completed = new Set(position.lessonsCompleted);
    const inSession = new Set([...freshAtoms, ...reviewKeys, ...early.map((i) => card(i).srsKey)]);
    const pool = [...catalogue.cards.values()].filter((e) => e.card.type === 'desk' && completed.has(e.lessonId) && !inSession.has(e.card.srsKey));
    assert.equal(desk.length, pool.length > 0 ? 1 : 0, `${label}: a desk card from a completed lesson when there is one`);
    if (desk.length === 1) assert.ok(completed.has(catalogue.cards.get(desk[0].cardId).lessonId), label);
  }

  // Test 18's order at 5 minutes: the reviews, then the new material, then the desk card.
  if (budget === 300) {
    const order = plan.map((i) => (i.part === 'new' ? 1 : i.part === 'desk' ? 2 : 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${label}: reviews first at 5 minutes`);
  }

  // With nothing due and nothing new, early reviews keep the streak: within B, at most 20.
  if (fresh.length === 0 && reviews.length === 0 && early.length > 0) {
    assert.ok(early.length <= 20, label);
    assert.ok(result.estimateSec <= budget, `${label}: an early-review session stays within the budget`);
  }
}

test('over many generated states, at all four lengths, every assembled session keeps the invariants (tests 3, 4, 18, 27)', () => {
  let sessions = 0;
  const seen = { fresh: 0, reviews: 0, early: 0, desk: 0, mixed: 0, catchingUp: 0, underRatio: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const random = seededRandom(seed);
    const catalogue = catalogueOf(contentOf(generatedPack(random, { lessons: 6 + (seed % 9), teachHeavy: seed % 3 === 0 })));
    for (let state = 0; state < 6; state++) {
      const dueShare = [1, 3, 5, 8, 10, 0][state];
      for (const sessionSeconds of LENGTHS) {
        const { progress, lastShown } = generatedProgress(random, catalogue, clock(), DAY, { sessionSeconds, dueShare });
        const input = { progress, catalogue, day: DAY, lastShown };
        const label = `seed ${seed}, state ${state}, ${sessionSeconds}s`;
        const result = assembleDaily({ ...input, random: seededRandom(seed * 100 + state) });
        checkSession(result, input, label);

        // The same inputs and source give the same plan; another source changes only where
        // the reviews sit, never which cards are in the session.
        assert.deepEqual(assembleDaily({ ...input, random: seededRandom(seed * 100 + state) }), result, label);
        const other = assembleDaily({ ...input, random: seededRandom(seed * 100 + state + 7) });
        assert.deepEqual(ids(other.plan).sort(), ids(result.plan).sort(), label);
        assert.deepEqual(ids(other.plan, 'new'), ids(result.plan, 'new'), label);

        sessions++;
        const has = (part) => result.plan.some((i) => i.part === part);
        if (has('new')) seen.fresh++;
        if (has('review')) seen.reviews++;
        if (has('early')) seen.early++;
        if (has('desk')) seen.desk++;
        if (has('new') && has('review')) seen.mixed++;
        if (result.catchingUp) seen.catchingUp++;
        const testable = result.plan.filter((i) => isTestable(catalogue.cards.get(i.cardId).card)).length;
        if (result.plan.length > 0 && testable < 0.6 * result.plan.length) seen.underRatio++;
      }
    }
  }
  assert.equal(sessions, 60 * 6 * 4);
  // The states really do cover the cases the rules are about.
  for (const [what, count] of Object.entries(seen)) assert.ok(count >= 10, `${what}: ${count} of ${sessions} sessions`);
});

// ---------------------------------------------------------------------- particular cases

test("a new learner's first session takes the first lesson, in order, and ends on its desk card", () => {
  const phone = phoneWith('bundle-bakery.json', clock());
  const result = assemble(phone);
  const lesson = phone.catalogue.lessons.get('bk_l01').lesson;
  assert.deepEqual(ids(result.plan), lesson.cards.map((c) => c.cardId));
  assert.ok(result.plan.every((i) => i.part === 'new'));
  assert.deepEqual(result.plan.filter((i) => i.final).map((i) => i.cardId), ['bk_l01_c08']);
  assert.deepEqual([result.lessonId, result.catchingUp, result.dueCount, result.lengthSec], ['bk_l01', false, 0, 660]);
  assert.equal(result.estimateSec, 275);
  assert.deepEqual(result.plan.map((i) => i.block), [0, 0, 1, 1, 2, 3, 4, 5, 6]);
});

test('a session never starts the next lesson, and stops at a block that would pass the budget', () => {
  const phone = phoneWith('bundle-bakery.json', clock());
  for (const sessionSeconds of LENGTHS) {
    const result = assemble({ ...phone, progress: withLength(phone.progress, sessionSeconds) });
    assert.ok(ids(result.plan).every((id) => id.startsWith('bk_l01')), `${sessionSeconds}s`);
  }
  // A lesson longer than five minutes: the 5-minute session takes whole blocks that fit.
  const long = packOf([{ id: 'a1', cards: ['teach', 'mcq', 'teach', 'match', 'teach', 'order', 'teach', 'multi', 'teach', 'match', 'teach', 'desk'] }]);
  const catalogue = catalogueOf(contentOf(long));
  const progress = withLength(phone.progress, 300);
  const result = assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(1) });
  assert.deepEqual(ids(result.plan), ['a1_c01', 'a1_c02', 'a1_c03', 'a1_c04', 'a1_c05', 'a1_c06', 'a1_c07', 'a1_c08', 'a1_c09', 'a1_c10']);
  assert.equal(result.estimateSec, 290, 'the last block, 85 seconds, would pass 300');
  assert.equal(result.plan.some((i) => i.final), false, "the lesson's desk card isn't reached, and no lesson is completed yet");
});

test('due reviews are spread among the new cards at block boundaries, and the session still ends on a desk card (test 27)', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery-next.json', c), { currentLesson: 'pa_l01', currentCardIndex: 0, lessonsCompleted: ['bk_l01', 'bk_l02'] });
  phone = { ...phone, progress: { ...phone.progress, atoms: atomsOf(phone.catalogue, ['bk_l01', 'bk_l02'], 2, '2026-11-14') } };
  const places = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const result = assemble(phone, { seed });
    const plan = result.plan;
    assert.deepEqual(ids(plan, 'new'), phone.catalogue.lessons.get('pa_l01').lesson.cards.map((c) => c.cardId));
    assert.equal(plan[plan.length - 1].cardId, 'pa_l01_c07', "the lesson's own desk card is last");
    assert.equal(plan[plan.length - 1].final, true);
    const reviews = plan.filter((i) => i.part === 'review');
    assert.ok(reviews.length >= 5, `${reviews.length} reviews`);
    assert.ok(reviews.reduce((sum, i) => sum + estimateOf(phone.catalogue.cards.get(i.cardId).card), 0) <= 0.4 * 660);
    // One review per atom: the lesson's own card tests this atom, so no review does.
    assert.ok(!reviews.some((i) => phone.catalogue.cards.get(i.cardId).card.srsKey === 'atom.ingredient.hydration'));
    plan.forEach((item, i) => {
      if (item.part === 'review') places.add(ids(plan, 'new').indexOf(plan.slice(i).find((x) => x.part === 'new').cardId));
      if (item.cardId === 'pa_l01_c01') assert.equal(plan[i + 1].cardId, 'pa_l01_c02', 'no review between a teach card and its test');
      if (item.cardId === 'pa_l01_c03') assert.equal(plan[i + 1].cardId, 'pa_l01_c04');
    });
  }
  // Over many draws the reviews land before every block, the last one included, and never
  // inside one: before cards 1, 3, 5, 6 and 7 of the lesson.
  assert.deepEqual([...places].sort((a, b) => a - b), [0, 2, 4, 5, 6]);
});

test('at 5 minutes the reviews and missed cards come first, then new material if time remains, then the desk card (test 18)', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery-next.json', c), { currentLesson: 'pa_l01', currentCardIndex: 0, lessonsCompleted: ['bk_l01', 'bk_l02'] });
  const atoms = atomsOf(phone.catalogue, ['bk_l01', 'bk_l02'], 2, '2026-11-25');
  for (const key of ['atom.ingredient.levain', 'atom.technique.timing']) atoms[key] = atomIn(1, '2026-11-15');
  atoms['atom.ingredient.salt'] = atomIn(1, '2026-11-14', { lastMissedCardId: 'bk_l01_c10' });
  phone = { ...phone, progress: withLength({ ...phone.progress, atoms }, 300) };
  for (let seed = 1; seed <= 10; seed++) {
    const { plan, estimateSec } = assemble(phone, { seed });
    assert.deepEqual(plan.slice(0, 3).map((i) => [i.cardId, i.part]), [
      ['bk_l01_c10', 'review'],
      ['bk_l01_c02', 'review'],
      ['bk_l01_c07', 'review'],
    ]);
    // Three reviews take 60 seconds, so the whole lesson, 205 seconds, still fits: new
    // material after the reviews, ending on the lesson's own desk card.
    assert.deepEqual(plan.slice(3).map((i) => i.cardId), phone.catalogue.lessons.get('pa_l01').lesson.cards.map((card) => card.cardId));
    assert.ok(plan.slice(3).every((i) => i.part === 'new'));
    assert.equal(plan[plan.length - 1].final, true);
    assert.equal(estimateSec, 265);
  }
  // With more due, only part of the lesson fits, and a desk card from a completed lesson
  // closes the session.
  for (const key of ['atom.ingredient.pre-ferments', 'atom.technique.loaf-steps']) atoms[key] = atomIn(1, '2026-11-15');
  const part = assemble({ ...phone, progress: withLength({ ...phone.progress, atoms }, 300) });
  assert.deepEqual(part.plan.map((i) => i.part), ['review', 'review', 'review', 'review', 'review', 'new', 'new', 'new', 'new', 'desk']);
  assert.deepEqual(ids(part.plan, 'new'), ['pa_l01_c01', 'pa_l01_c02', 'pa_l01_c03', 'pa_l01_c04']);
  assert.deepEqual([part.plan[9].cardId, part.plan[9].final, part.estimateSec], ['bk_l01_c08', true, 285]);
  // With enough due to fill five minutes, there is no room for new material.
  const full = { ...phone, progress: { ...phone.progress, atoms: atomsOf(phone.catalogue, ['bk_l01', 'bk_l02'], 2, '2026-11-14') } };
  const { plan } = assemble(full);
  assert.equal(plan.filter((i) => i.part === 'new').length, 0);
  assert.ok(plan.filter((i) => i.part === 'review').length >= 6);
});

test('a 14-day absence gives at most 20 reviews, and no new material until the backlog clears (test 7)', () => {
  const lessons = Array.from({ length: 8 }, (_, n) => ({ id: `b${n + 1}`, cards: ['teach', 'mcq', 'cloze', 'mcq', 'cloze', 'mcq', 'cloze', 'mcq', 'desk'] }));
  const catalogue = catalogueOf(contentOf(packOf(lessons)));
  const base = phoneWith([], clock()).progress;
  const position = { currentLesson: 'b8', currentCardIndex: 0, lessonsCompleted: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'], catchingUp: false };
  const keys = [...catalogue.atoms.keys()].filter((key) => !key.includes('b8'));
  assert.equal(keys.length, 56);
  const dueFor = (count, catchingUp, sessionSeconds = 660) => ({
    ...withLength(base, sessionSeconds),
    position: { ...position, catchingUp },
    atoms: Object.fromEntries(keys.map((key, i) => [key, atomIn(1 + (i % 5), i < count ? '2026-11-01' : '2026-12-01')])),
  });
  const run = (progress) => assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(3) });

  // Away for a fortnight: 56 atoms due.
  for (const sessionSeconds of LENGTHS) {
    const back = run(dueFor(56, false, sessionSeconds));
    assert.deepEqual([back.dueCount, back.catchingUp], [56, true], `${sessionSeconds}s`);
    const parts = back.plan.map((i) => i.part);
    assert.ok(!parts.includes('new'), 'no new material');
    assert.ok(parts.filter((p) => p === 'review').length <= 20, 'never a wall');
    assert.ok(back.estimateSec <= sessionSeconds + OVERRUN_SECONDS);
  }
  const fourteen = run(dueFor(56, false, 840));
  assert.equal(fourteen.plan.filter((i) => i.part === 'review').length, 20, 'capped at 20 even where more would fit');
  // The most overdue first; ties to the lower box, then the key.
  const chosen = fourteen.plan.filter((i) => i.part === 'review').map((i) => catalogue.cards.get(i.cardId).card.srsKey);
  const boxes = chosen.map((key) => dueFor(56, false).atoms[key].box);
  assert.deepEqual(boxes, [...boxes].sort((a, b) => a - b));
  assert.ok(boxes.filter((b) => b === 1).length >= 11 && Math.max(...boxes) === 2);

  // Still clearing: the switch holds between 20 and 40, and comes off below 20.
  const clearing = run(dueFor(34, true));
  assert.deepEqual([clearing.dueCount, clearing.catchingUp, clearing.plan.some((i) => i.part === 'new')], [34, true, false]);
  assert.equal(run(dueFor(34, false)).catchingUp, false, 'it only turns on above 40');
  assert.ok(run(dueFor(34, false)).plan.some((i) => i.part === 'new'));
  const cleared = run(dueFor(19, true));
  assert.deepEqual([cleared.dueCount, cleared.catchingUp], [19, false]);
  assert.ok(cleared.plan.some((i) => i.part === 'new'), 'new material comes back');
});

test('at the default length, once reviews exist, the plan runs between 9 and 13 minutes (test 3)', () => {
  const lessons = Array.from({ length: 6 }, (_, n) => ({
    id: `d${n + 1}`,
    cards: ['teach', 'mcq', 'teach', 'cloze', 'match', 'teach', 'multi', 'order', 'teach', 'mcq', 'cloze', 'teach', 'variant', 'mcq', 'desk'],
  }));
  const catalogue = catalogueOf(contentOf(packOf(lessons)));
  const base = phoneWith([], clock()).progress;
  for (let reached = 2; reached < 6; reached++) {
    const done = lessons.slice(0, reached).map((l) => l.id);
    // The two lessons finished last are due; the ones before them are not yet.
    const atoms = {};
    for (const [key, entries] of catalogue.atoms) {
      const n = done.indexOf(entries[0].lessonId);
      if (n >= 0) atoms[key] = atomIn(2, n >= reached - 2 ? '2026-11-14' : '2026-11-30');
    }
    const progress = { ...base, position: { currentLesson: lessons[reached].id, currentCardIndex: 0, lessonsCompleted: done, catchingUp: false }, atoms };
    const result = assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(reached) });
    assert.ok(result.estimateSec >= 540 && result.estimateSec <= 780, `${result.estimateSec}s`);
    assert.ok(result.plan.some((i) => i.part === 'review') && result.plan.some((i) => i.part === 'new'));
  }
});

test('the ratio guard adds early reviews until 60% of the cards are testable, soonest due first (test 4)', () => {
  const pack = packOf([
    { id: 'r1', cards: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'desk'] },
    { id: 'r2', cards: ['teach', 'teach', 'teach', 'mcq', 'teach', 'teach', 'mcq', 'desk'] },
  ]);
  const catalogue = catalogueOf(contentOf(pack));
  const base = phoneWith([], clock()).progress;
  const atoms = {};
  [...catalogue.atoms.keys()].filter((key) => key.includes('r1')).forEach((key, i) => (atoms[key] = atomIn(3, `2026-11-${20 + i}`)));
  const progress = { ...base, position: { currentLesson: 'r2', currentCardIndex: 0, lessonsCompleted: ['r1'], catchingUp: false }, atoms };
  const result = assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(1) });
  // The lesson alone is 3 testable of 8. Five early reviews make it 8 of 13, which is 61%.
  assert.equal(result.plan.filter((i) => i.part === 'new').length, 8);
  assert.deepEqual(ids(result.plan, 'early').sort(), ['r1_c01', 'r1_c02', 'r1_c03', 'r1_c04', 'r1_c05']);
  assert.equal(result.plan.filter((i) => i.part === 'review').length, 0, 'nothing was due');
  assert.equal(result.plan[result.plan.length - 1].cardId, 'r2_c08');
  const testable = result.plan.filter((i) => isTestable(catalogue.cards.get(i.cardId).card)).length;
  assert.ok(testable >= 0.6 * result.plan.length);

  // A learner's very first session has no atom to add: it keeps its lesson as assembled.
  const first = assembleDaily({
    progress: { ...base, position: { currentLesson: 'r2', currentCardIndex: 0, lessonsCompleted: [], catchingUp: false } },
    catalogue,
    day: DAY,
    lastShown: new Map(),
    random: seededRandom(1),
  });
  assert.deepEqual(first.plan.map((i) => i.part), Array(8).fill('new'));
});

test('when early reviews would pass B + 120 seconds, the last block of new material is dropped and the guard tries again', () => {
  const pack = packOf([
    { id: 's1', cards: ['match', 'match', 'match', 'match', 'match', 'match', 'match', 'match', 'match', 'desk'] },
    { id: 's2', cards: ['teach', 'mcq', 'teach', 'teach', 'teach', 'teach', 'teach', 'mcq', 'desk'] },
  ]);
  const catalogue = catalogueOf(contentOf(pack));
  const base = withLength(phoneWith([], clock()).progress, 300);
  const atoms = {};
  [...catalogue.atoms.keys()].filter((key) => key.includes('s1')).forEach((key, i) => (atoms[key] = atomIn(3, `2026-11-${20 + i}`)));
  const progress = { ...base, position: { currentLesson: 's2', currentCardIndex: 0, lessonsCompleted: ['s1'], catchingUp: false }, atoms };
  const result = assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(1) });
  // Two blocks fit 300 seconds (45 + 145, with a 60-second desk card), but they are 2
  // testable of 8, and the seven early reviews that would mend it pass 420 seconds. With
  // the second block dropped, the first block needs only one.
  assert.deepEqual(ids(result.plan, 'new'), ['s2_c01', 's2_c02']);
  assert.equal(result.plan.filter((i) => i.part === 'early').length, 0, 'the desk card alone brings two of three');
  assert.deepEqual([result.plan[result.plan.length - 1].part, result.plan[result.plan.length - 1].final], ['desk', true]);
  assert.ok(result.estimateSec <= 420);
  checkSession(result, { progress, catalogue, day: DAY, lastShown: new Map() }, 'dropped block');
});

test('with nothing due and nothing new, the session is early reviews within the budget, at most 20; with nothing at all it is empty', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery.json', c), { currentLesson: null, currentCardIndex: 0, lessonsCompleted: ['bk_l01', 'bk_l02'] });
  // The two desk atoms are due later than the rest, so one of them is left for the end.
  const atoms = atomsOf(phone.catalogue, ['bk_l01', 'bk_l02'], 3, '2026-11-25');
  for (const key of ['atom.desk.order-note', 'atom.desk.handover']) atoms[key] = atomIn(3, '2026-12-20');
  phone = { ...phone, progress: { ...phone.progress, atoms } };
  const counts = [];
  for (const sessionSeconds of LENGTHS) {
    const result = assemble({ ...phone, progress: withLength(phone.progress, sessionSeconds) });
    const parts = result.plan.map((i) => i.part);
    assert.ok(parts.slice(0, -1).every((p) => p === 'early') && parts.length > 1, `${sessionSeconds}s: ${parts}`);
    assert.ok(result.estimateSec <= sessionSeconds, `${sessionSeconds}s`);
    assert.deepEqual([result.lessonId, result.dueCount], [null, 0]);
    counts.push(parts.length);
  }
  // 5 minutes: nine early reviews, 235 seconds, and a desk card. From 8 minutes every
  // atom fits: the desk atoms are then early reviews themselves, and none is left over.
  assert.deepEqual(counts, [10, 13, 13, 13]);
  const short = assemble({ ...phone, progress: withLength(phone.progress, 300) });
  assert.deepEqual([short.plan[9].cardId, short.plan[9].part, short.plan[9].final, short.estimateSec], ['bk_l01_c08', 'desk', true, 295]);
  const many = packOf(Array.from({ length: 5 }, (_, n) => ({ id: `e${n + 1}`, cards: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq'] })));
  const catalogue = catalogueOf(contentOf(many));
  const progress = {
    ...withLength(phone.progress, 840),
    position: { currentLesson: null, currentCardIndex: 0, lessonsCompleted: ['e1', 'e2', 'e3', 'e4', 'e5'], catchingUp: false },
    atoms: Object.fromEntries([...catalogue.atoms.keys()].map((key) => [key, atomIn(2, '2026-11-20')])),
  };
  const capped = assembleDaily({ progress, catalogue, day: DAY, lastShown: new Map(), random: seededRandom(1) });
  assert.deepEqual([capped.plan.length, capped.estimateSec], [20, 400], 'at most 20, though 42 would fit');

  // Nothing installed, or a learner who has met nothing and has nothing to take.
  const nothing = phoneWith([], c);
  assert.deepEqual(assemble(nothing).plan, []);
  assert.equal(assemble(nothing).lessonId, null);
});

test('when the track waits for a pack, or every lesson is done, reviews may use the whole budget', () => {
  const c = clock();
  // The next track lists two packs; only the first is installed.
  let phone = phoneWith(['glossary-next.json', 'pack-bakery-next.json', 'track-bakery-next.json'], c);
  assert.equal(phone.catalogue.order.stoppedAt, 'pastry_basics');
  phone = at(phone, { currentLesson: null, currentCardIndex: 0, lessonsCompleted: ['bk_l01', 'bk_l02'] });
  phone = { ...phone, progress: withLength({ ...phone.progress, atoms: atomsOf(phone.catalogue, ['bk_l01', 'bk_l02'], 2, '2026-11-14') }, 480) };
  const result = assemble(phone);
  const reviews = result.plan.filter((i) => i.part === 'review');
  const reviewSeconds = reviews.reduce((sum, i) => sum + estimateOf(phone.catalogue.cards.get(i.cardId).card), 0);
  assert.ok(reviewSeconds > 0.4 * 480, `${reviewSeconds}s of reviews`);
  assert.ok(result.estimateSec <= 480);
  assert.deepEqual([result.lessonId, result.plan.some((i) => i.part === 'new')], [null, false]);
  // Both desk atoms are due and among the reviews, so no desk card is left over for the end.
  assert.ok(['bk_l01_c08', 'bk_l02_c07'].every((id) => ids(result.plan, 'review').includes(id)));
  assert.equal(result.plan.some((i) => i.final), false);
});

test('an atom a content update adds to a completed lesson comes up as a review in the next daily session (test 37)', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery.json', c), { currentLesson: 'bk_l02', currentCardIndex: 0, lessonsCompleted: ['bk_l01'] });
  phone = { ...phone, progress: { ...phone.progress, atoms: atomsOf(phone.catalogue, ['bk_l01'], 2, '2026-11-25') } };
  assert.equal(assemble(phone).plan.filter((i) => i.part === 'review').length, 0, 'before the update, nothing is due');
  phone = installOn(phone, 'pack-bakery-next.json', c);
  for (const sessionSeconds of LENGTHS) {
    const { plan, dueCount } = assemble({ ...phone, progress: withLength(phone.progress, sessionSeconds) });
    assert.equal(dueCount, 1);
    assert.deepEqual(plan.filter((i) => i.part === 'review').map((i) => i.cardId), ['bk_l01_c10'], `${sessionSeconds}s`);
  }
});

test('the final desk card comes from a completed lesson, the one presented longest ago, when the lesson is not finished', () => {
  const pack = packOf([
    { id: 'f1', cards: ['mcq', 'desk'] },
    { id: 'f2', cards: ['mcq', 'desk'] },
    { id: 'f3', cards: ['teach', 'mcq', 'teach', 'match', 'teach', 'order', 'teach', 'multi', 'teach', 'match', 'teach', 'order', 'teach', 'match', 'desk'] },
  ]);
  const catalogue = catalogueOf(contentOf(pack));
  const base = withLength(phoneWith([], clock()).progress, 300);
  const atoms = Object.fromEntries([...catalogue.atoms.keys()].filter((k) => !k.includes('f3')).map((key) => [key, atomIn(3, '2026-11-25')]));
  const progress = { ...base, position: { currentLesson: 'f3', currentCardIndex: 0, lessonsCompleted: ['f1', 'f2'], catchingUp: false }, atoms };
  const last = (lastShown) => {
    const { plan } = assembleDaily({ progress, catalogue, day: DAY, lastShown, random: seededRandom(1) });
    assert.ok(plan.some((i) => i.part === 'new') && !ids(plan).includes('f3_c15'));
    return plan[plan.length - 1];
  };
  assert.deepEqual(last(new Map()), { cardId: 'f1_c02', part: 'desk', block: last(new Map()).block, final: true }, 'never presented: file order');
  assert.equal(last(new Map([['f1_c02', 50]])).cardId, 'f2_c02', 'the one never presented');
  assert.equal(last(new Map([['f1_c02', 50], ['f2_c02', 20]])).cardId, 'f2_c02', 'the one presented longest ago');
  // A pack's first sessions have no completed lesson: the session ends without one.
  const early = { ...progress, position: { currentLesson: 'f1', currentCardIndex: 0, lessonsCompleted: [], catchingUp: false }, atoms: {} };
  const firstLesson = packOf([{ id: 'f1', cards: ['teach', 'mcq', 'teach', 'match', 'teach', 'order', 'teach', 'multi', 'teach', 'match', 'teach', 'order', 'desk'] }]);
  const { plan } = assembleDaily({ progress: early, catalogue: catalogueOf(contentOf(firstLesson)), day: DAY, lastShown: new Map(), random: seededRandom(1) });
  assert.ok(plan.length > 0 && !plan.some((i) => i.final));
});

test('a redo is every card of the lesson in order, in its blocks, ending on its desk card', () => {
  const { catalogue } = phoneWith('bundle-bakery.json', clock());
  const lesson = catalogue.lessons.get('bk_l02').lesson;
  const plan = assembleRedo(lesson);
  assert.deepEqual(ids(plan), lesson.cards.map((c) => c.cardId));
  assert.ok(plan.every((i) => i.part === 'redo'));
  assert.deepEqual(plan.map((i) => i.block), [0, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(plan.map((i) => i.final), [false, false, false, false, false, false, true]);
});
