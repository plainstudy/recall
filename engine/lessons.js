// Lesson order (spec §5.7) and where the learner's position goes after a content update.
//
// `content` is what is installed: { track, packs }, with `packs` mapping each packId to
// its pack as imported.

import { readPack } from './cards.js';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// A pack's lessons as the learner may see them: by `order`, unverified ones passed over.
function shownLessons(pack) {
  const read = readPack(pack);
  return read.ok ? read.pack.lessons : [];
}

function packsInOrder(packs) {
  return Object.values(packs)
    .filter(isObject)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.packId).localeCompare(String(b.packId)));
}

// The lessons in study order: the track's packs in its order, or, with no track, the
// installed packs by their own `order`. Each pack's lessons by `order`, unverified ones
// passed over. The order stops where the track reaches a pack that isn't installed, and
// `stoppedAt` names that pack.
export function lessonOrder(content) {
  const packs = isObject(content) && isObject(content.packs) ? content.packs : {};
  const track = isObject(content) && isObject(content.track) && Array.isArray(content.track.packs) ? content.track : null;
  const lessons = [];
  const add = (pack) => {
    for (const lesson of shownLessons(pack)) lessons.push({ packId: pack.packId, packTitle: pack.title, lesson });
  };
  if (!track) {
    packsInOrder(packs).forEach(add);
    return { lessons, stoppedAt: null };
  }
  for (const packId of track.packs) {
    if (!Object.hasOwn(packs, packId)) return { lessons, stoppedAt: packId };
    add(packs[packId]);
  }
  return { lessons, stoppedAt: null };
}

const completedSet = (position) => new Set(Array.isArray(position.lessonsCompleted) ? position.lessonsCompleted : []);

// The first lesson in order that isn't completed, or null.
export function firstOpenLesson(order, position) {
  const done = completedSet(position);
  const open = order.lessons.find((entry) => !done.has(entry.lesson.lessonId));
  return open ? open.lesson.lessonId : null;
}

// The lesson the learner is on: `currentLesson`, or else the first open lesson in order.
export function currentLessonId(order, position) {
  return position.currentLesson != null ? position.currentLesson : firstOpenLesson(order, position);
}

// Every lesson on the phone that still exists for the learner: in an installed pack, and
// not unverified. Wherever the track stops.
function existingLessons(content) {
  const found = new Map();
  for (const pack of Object.values(isObject(content) && isObject(content.packs) ? content.packs : {})) {
    if (isObject(pack)) for (const lesson of shownLessons(pack)) found.set(lesson.lessonId, lesson);
  }
  return found;
}

// The position once a lesson is complete: the lesson joins those completed, and the
// position moves to the next lesson in order that isn't completed, at card 0. With none
// after it, the current lesson is null, which means the first open lesson in order.
export function positionAfterCompleting(position, order, lessonId) {
  const completed = completedSet(position).has(lessonId) ? [...position.lessonsCompleted] : [...(position.lessonsCompleted || []), lessonId];
  const done = new Set(completed);
  const at = order.lessons.findIndex((entry) => entry.lesson.lessonId === lessonId);
  const next = at < 0 ? null : order.lessons.slice(at + 1).find((entry) => !done.has(entry.lesson.lessonId));
  return { ...position, currentLesson: next ? next.lesson.lessonId : null, currentCardIndex: 0, lessonsCompleted: completed };
}

// The position after an import or a pack removed. If the current lesson has gone or is
// now unverified, it moves to the first lesson in order that isn't completed, at card 0.
// If the card index is past the end of the lesson, the lesson counts as completed and the
// position moves on to the next lesson in order. Otherwise nothing changes.
export function positionAfterUpdate(position, content) {
  if (position.currentLesson == null) return position;
  const order = lessonOrder(content);
  const lesson = existingLessons(content).get(position.currentLesson);
  if (!lesson) {
    return { ...position, currentLesson: firstOpenLesson(order, position), currentCardIndex: 0 };
  }
  if (position.currentCardIndex < lesson.cards.length) return position;
  return positionAfterCompleting(position, order, lesson.lessonId);
}
