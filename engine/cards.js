// Reading a pack for display. It accepts both card shapes in use: the current one, and
// the older one without pair ids, figures or artifacts. It checks only what display
// needs; version and class checks belong to import. Fields it doesn't know are kept.

import { TESTABLE_TYPES } from './scoring.js';

export const CARD_TYPES = ['teach', ...TESTABLE_TYPES];

export const MESSAGES = {
  notAPack: "This file isn't a pack: it has no lessons.",
  glossary: 'This file is a glossary, not a pack.',
  noLessons: 'This pack has no lessons to show.',
  unknownType: "This card can't be shown: its type isn't one this version knows.",
  incomplete: "This card can't be shown: its answers are incomplete.",
  sharedId: "This card can't be shown: two of its answers share an id.",
  figureMissing: "This card can't be shown: its figure is missing.",
};

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string';
const statusOf = (lesson) => (isObject(lesson.verification) ? lesson.verification.status : undefined);

// { ok: true, pack } with lessons sorted and cards read, or { ok: false, message }.
export function readPack(data) {
  if (!isObject(data)) return { ok: false, message: MESSAGES.notAPack };
  if (!Array.isArray(data.lessons)) {
    const glossary = 'glossaryVersion' in data || Array.isArray(data.terms);
    return { ok: false, message: glossary ? MESSAGES.glossary : MESSAGES.notAPack };
  }
  const figures = isObject(data.figures) ? data.figures : {};
  const lessons = data.lessons
    .map((lesson, index) => ({ lesson, index }))
    .filter(({ lesson }) => isObject(lesson) && Array.isArray(lesson.cards) && lesson.cards.length > 0)
    .filter(({ lesson }) => statusOf(lesson) !== 'unverified')
    .sort((a, b) => orderKey(a) - orderKey(b) || a.index - b.index)
    .map(({ lesson }) => ({
      ...lesson,
      needsReview: statusOf(lesson) === 'needs-review',
      cards: lesson.cards.map((card) => readCard(card, figures)),
    }));
  if (lessons.length === 0) return { ok: false, message: MESSAGES.noLessons };
  return { ok: true, pack: { ...data, lessons } };
}

function orderKey({ lesson }) {
  const n = Number(lesson.order);
  return lesson.order != null && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

// A card ready for display. Match pairs get ids, a named figure is looked up, and a card
// that can't be shown carries the reason in `unshowable`.
export function readCard(card, figures = {}) {
  if (!isObject(card)) return { type: null, unshowable: MESSAGES.unknownType };
  const out = { ...card };
  if (card.type === 'match' && Array.isArray(card.pairs)) out.pairs = withPairIds(card.pairs);
  if (card.figure != null) out.resolvedFigure = resolveFigure(card.figure, figures);
  const problem = problemWith(out);
  if (problem) out.unshowable = problem;
  return out;
}

// A pair without an id takes its place in the file as its id: "1", "2" and so on. If the
// ids that result aren't unique, every pair takes its place instead.
export function withPairIds(pairs) {
  const ids = pairs.map((p, i) => (isObject(p) && p.id != null && p.id !== '' ? String(p.id) : String(i + 1)));
  const unique = new Set(ids).size === ids.length;
  return pairs.map((p, i) => ({ ...(isObject(p) ? p : {}), id: unique ? ids[i] : String(i + 1) }));
}

// A figure named by id in the pack's figures, or given in place. Returns
// { layers: [svg, ...], alt, viewBox } or null. A stepped figure has several layers.
export function resolveFigure(ref, figures = {}) {
  const fig = isText(ref) ? (Object.hasOwn(figures, ref) ? figures[ref] : null) : ref;
  if (!isObject(fig)) return null;
  const frames = Array.isArray(fig.frames) ? fig.frames.filter((f) => isText(f) && f.trim() !== '') : [];
  const layers = frames.length > 0 ? frames : isText(fig.svg) && fig.svg.trim() !== '' ? [fig.svg] : [];
  if (layers.length === 0) return null;
  return { layers, alt: isText(fig.alt) ? fig.alt : '', viewBox: parseViewBox(layers[0]) };
}

const VIEW_BOX = /<svg\b[^>]*?\sviewBox\s*=\s*(["'])([^"']*)\1/i;

// The root element's viewBox as [x, y, width, height], or null.
export function parseViewBox(svg) {
  const m = isText(svg) ? VIEW_BOX.exec(svg) : null;
  if (!m) return null;
  const n = m[2].trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite) || n[2] <= 0 || n[3] <= 0) return null;
  return n;
}

const numbers = (v, length) =>
  Array.isArray(v) && (length === undefined || v.length === length) && v.every((x) => Number.isFinite(x)) ? v : null;

// A hotspot region's shape in the figure's viewBox units, or null when it is malformed.
export function regionShape(region) {
  const s = isObject(region) && isObject(region.shape) ? region.shape : null;
  if (!s) return null;
  if (s.rect) {
    const r = numbers(s.rect, 4);
    return r && r[2] > 0 && r[3] > 0 ? { kind: 'rect', x: r[0], y: r[1], width: r[2], height: r[3] } : null;
  }
  if (s.circle) {
    const c = numbers(s.circle, 3);
    return c && c[2] > 0 ? { kind: 'circle', cx: c[0], cy: c[1], r: c[2] } : null;
  }
  if (s.polygon) {
    const p = numbers(s.polygon);
    return p && p.length >= 6 && p.length % 2 === 0 ? { kind: 'polygon', points: p } : null;
  }
  return null;
}

function listProblem(list, valid) {
  if (!Array.isArray(list) || list.length < 2) return MESSAGES.incomplete;
  if (!list.every((x) => isObject(x) && x.id != null && valid(x))) return MESSAGES.incomplete;
  if (new Set(list.map((x) => String(x.id))).size !== list.length) return MESSAGES.sharedId;
  return null;
}

function choiceProblem(list, valid = (x) => isText(x.text)) {
  return listProblem(list, valid) || (list.some((x) => x.correct === true) ? null : MESSAGES.incomplete);
}

function problemWith(card) {
  switch (card.type) {
    case 'teach':
      return null;
    case 'mcq':
    case 'desk':
    case 'multi':
    case 'variant':
      return choiceProblem(card.options);
    case 'cloze':
      return choiceProblem(card.chips);
    case 'match':
      return listProblem(card.pairs, (p) => isText(p.left) && isText(p.right));
    case 'order':
      return listProblem(card.items, (item) => isText(item.text) && Number.isFinite(Number(item.position)));
    case 'hotspot':
      if (!card.resolvedFigure || !card.resolvedFigure.viewBox) return MESSAGES.figureMissing;
      return choiceProblem(card.regions, (r) => regionShape(r) !== null);
    default:
      return MESSAGES.unknownType;
  }
}
