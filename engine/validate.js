// Import validation (spec §11.1) for packs, glossaries, tracks and bundles. The weekly
// report's progress block is checked in progress.js.
//
// Once a file is recognised, the checks run in this order: an older format; engineMin;
// the version against what is installed. Any of those three ends the check with its one
// message (`stop`). Past them, every problem is listed in file order, each naming its
// item. Warnings never refuse a file.
//
// Every check takes `ctx`: { engineVersion, installed: { bundle, glossary, track, packs } },
// where `packs` maps each installed packId to its pack.

import { CARD_TYPES, parseViewBox, regionShape } from './cards.js';
import { isDay } from './days.js';
import { TESTABLE_TYPES } from './scoring.js';
import { compareVersions, fullVersion, isContentVersion, isVersion } from './versions.js';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string';
const hasText = (x) => typeof x === 'string' && x.trim() !== '';
const isId = (x) => (typeof x === 'string' && x !== '') || Number.isInteger(x);

const PACK_ID = /^[a-z0-9_]+$/; // packId, lessonId, cardId
const TERM_ID = /^[a-z0-9-]+$/; // term, domain, family and category ids
const TRACK_ID = /^[a-z0-9_-]+$/; // trackId, bundleId
const SRS_KEY = /^atom\.[a-z0-9-]+\.[a-z0-9-]+$/;
const PREFIX = /^[A-Za-z0-9_]+$/;

const STATUSES = ['verified', 'needs-review', 'unverified'];
const ARTIFACT_KINDS = ['enquiry', 'quote', 'report', 'nameplate'];

export const MESSAGES = {
  olderPack: 'This pack is in an older format and needs converting.',
  olderGlossary: 'This glossary is in an older format and needs converting.',
  olderPart: (part) => `This bundle's ${part} is in an older format and needs converting.`,
  noEngineMin: (noun) => `This ${noun} doesn't say which version of the app it needs.`,
  engineTooOld: (noun, needs, app) =>
    `This ${noun} needs engine ${fullVersion(needs)} or later. This app is ${app}. Restart the app when it has updated.`,
  badVersion: (noun) => `This ${noun}'s version isn't written like 1.2.`,
  badTermVersion: (field) => `${field} must be a glossary version, written like 1.2.`,
  older: (noun, version, installed) => `This ${noun} is older than the one installed: ${version}, with ${installed} installed.`,
  alreadyInstalled: (noun, version) => `This ${noun} is already installed, at version ${version}.`,

  missing: (field) => `${field} is missing.`,
  badId: (field) => `${field} must use only lowercase letters, digits and the characters the format allows.`,
  notText: (field) => `${field} must be text.`,
  badClass: 'contentClass must be "public" or "private".',
  noOrder: 'order must be a number.',
  noLessons: 'the pack has no lessons.',
  noCards: 'the lesson has no cards.',
  badStatus: 'verification.status must be verified, needs-review or unverified.',
  idTwice: (kind, id) => `the ${kind} id "${id}" is used twice in this file.`,
  idElsewhere: (kind, id, where) => `the ${kind} id "${id}" is already used in ${where}.`,
  badPrerequisite: (id) => `its prerequisite "${id}" isn't an earlier lesson.`,
  unknownType: (type) => `its type "${type}" isn't one this version knows.`,
  noSrsKey: (type) => `a ${type} card needs an srsKey.`,
  teachSrsKey: 'a teach card never has an srsKey.',
  badSrsKey: 'its srsKey must look like atom.category.name, in lowercase.',
  badCount: (type, noun, min, max, n) => `a ${type} card needs ${min} to ${max} ${noun}; this one has ${n}.`,
  badEntry: (noun, n, needs) => `${noun} ${n} needs ${needs}.`,
  sharedId: (noun, id) => `two of its ${noun} share the id "${id}".`,
  oneCorrect: (type, noun, n) => `a ${type} card needs exactly one correct ${noun}; this one has ${n}.`,
  someCorrect: (type) => `a ${type} card needs at least one correct option.`,
  positions: (n) => `its items' positions must run from 1 to ${n}, once each.`,
  clozeGap: (n) => `a cloze card needs exactly one gap, written ___, in its prompt; this one has ${n}.`,
  variantTerm: 'a variant card needs the term it is about.',
  badArtifact: 'its artifact needs a kind (enquiry, quote, report or nameplate) and text.',
  hotspotNoFigure: 'a hotspot card needs a figure.',
  hotspotFigureMissing: (id) => `its figure "${id}" isn't in the pack, and a hotspot card can't do without it.`,
  hotspotFrames: "a hotspot card's figure must be a single svg, not frames.",
  hotspotViewBox: "a hotspot card's figure needs a viewBox, so its regions can be placed.",
  framesOnlyTeach: 'only a teach card can show a figure in frames.',
  badFigure: 'it needs either an svg or a list of frames, and alt text.',
  unsafeFigure: 'it contains something that could run, or load from outside the figure.',
  unknownTerm: (id) => `it names the term "${id}", which isn't in the glossary.`,
  noGlossary: 'its cards name glossary terms, and no glossary is installed. Import the glossary first.',

  badList: (field) => `${field} must be a list.`,
  noTerms: 'the glossary has no terms.',
  unknownRef: (field, id) => `its ${field} "${id}" doesn't exist in this glossary.`,
  familyDomain: (family, domain) => `its family "${family}" belongs to another domain than "${domain}".`,
  badTermStatus: 'status must be active or retired.',
  badVerification: 'verification must be verified, needs-review or unverified.',
  badBoolean: (field) => `${field} must be true or false.`,
  deletedTerm: (id) => `the installed glossary has the term "${id}", and this one doesn't. A glossary update never deletes a term; it retires it.`,
  installedRef: (pack, card, id) => `the installed pack "${pack}" has card ${card} naming the term "${id}", which this glossary doesn't have.`,

  noTrackPacks: 'the track lists no packs.',
  packTwice: (id) => `the track lists the pack "${id}" twice.`,

  badPrefix: 'reportPrefix may use only letters, digits and underscores.',
  badDay: (field) => `${field} must be a date written YYYY-MM-DD.`,
  notPart: (part) => `the bundle's ${part} isn't a ${part}.`,
  noBundlePacks: 'the bundle holds no packs.',
  packInBundleTwice: (id) => `the bundle holds the pack "${id}" twice.`,
  freePrivate: (id) => `the model "${id}" is free, so it can't be approved for private text.`,
};

export const WARNINGS = {
  figureNotInPack: (id) => `its figure "${id}" isn't in the pack, so the card shows without it.`,
  varianceUnchecked: 'variants not yet checked.',
  needsReview: (n, noun) => `${n} ${noun}${n === 1 ? ' is' : 's are'} marked needs-review.`,
};

// One problem written for people: "Card bk_l01_c04: a cloze card needs …".
export function problemText({ item, message }) {
  if (!item) return message.charAt(0).toUpperCase() + message.slice(1);
  return `${item.charAt(0).toUpperCase()}${item.slice(1)}: ${message}`;
}

function collector() {
  const problems = [];
  const warnings = [];
  return {
    problems,
    warnings,
    add: (item, message) => problems.push({ item: item || '', message }),
    warn: (item, message) => warnings.push({ item: item || '', message }),
  };
}

const stopped = (message) => ({ ok: false, stop: true, problems: [{ item: '', message }], warnings: [] });
const finished = (c) => ({ ok: c.problems.length === 0, stop: false, problems: c.problems, warnings: c.warnings });

// --------------------------------------------------------------- the first three checks

function olderFormat(kind, data) {
  if (kind === 'pack') return Object.hasOwn(data, 'contentClass') ? null : 'pack';
  if (kind === 'glossary') {
    const terms = Array.isArray(data.terms) ? data.terms : [];
    const old = !Object.hasOwn(data, 'domains') || terms.some((t) => isObject(t) && Object.hasOwn(t, 'partFamily'));
    return old ? 'glossary' : null;
  }
  return null;
}

function engineProblem(noun, data, engineVersion) {
  if (!isVersion(data.engineMin)) return MESSAGES.noEngineMin(noun);
  if (compareVersions(data.engineMin, engineVersion) > 0) return MESSAGES.engineTooOld(noun, data.engineMin, engineVersion);
  return null;
}

const VERSION_FIELD = { pack: 'packVersion', glossary: 'glossaryVersion', track: 'trackVersion', bundle: 'bundleVersion' };

// The installed counterpart of a file, whose version it is compared with.
function installedTwin(kind, data, installed) {
  if (kind === 'pack') return installed.packs[data.packId] || null;
  if (kind === 'glossary') return installed.glossary;
  if (kind === 'track') return installed.track && installed.track.trackId === data.trackId ? installed.track : null;
  return null;
}

// null when the version may go ahead; otherwise the one message. `sameIsFine` lets a part
// of a bundle arrive unchanged.
function versionProblem(kind, noun, data, installed, sameIsFine) {
  const field = VERSION_FIELD[kind];
  if (!isContentVersion(data[field])) return MESSAGES.badVersion(noun);
  const twin = installedTwin(kind, data, installed);
  if (!twin || !isContentVersion(twin[field])) return null;
  const order = compareVersions(data[field], twin[field]);
  if (order < 0) return MESSAGES.older(noun, data[field], twin[field]);
  if (order === 0 && !sameIsFine) return MESSAGES.alreadyInstalled(noun, data[field]);
  return null;
}

// ------------------------------------------------------------------------------ figures

const UNSAFE = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<[^>]*\son[a-z]+\s*=/i,
  /<!\s*(DOCTYPE|ENTITY)\b/i,
  /@import\b/i,
  /<[^>]*\s(?:xlink:)?href\s*=\s*(?:"(?!#)|'(?!#)|[^"'#\s>])/i,
  /<[^>]*\ssrc\s*=/i,
  /url\(\s*(?:"(?!#)|'(?!#)|[^"'#\s)])/i,
];

// An SVG string that could run code or load anything from outside itself.
export const unsafeSvg = (svg) => UNSAFE.some((re) => re.test(svg));

// The layers of a figure object, or null when it has neither svg nor frames.
function figureLayers(fig) {
  if (Array.isArray(fig.frames)) return fig.frames.length > 0 && fig.frames.every(hasText) ? fig.frames : null;
  return hasText(fig.svg) ? [fig.svg] : null;
}

function figureProblem(fig) {
  if (!isObject(fig) || !hasText(fig.alt)) return MESSAGES.badFigure;
  const layers = figureLayers(fig);
  if (!layers) return MESSAGES.badFigure;
  if (layers.some(unsafeSvg)) return MESSAGES.unsafeFigure;
  return null;
}

// ------------------------------------------------------------------------------- cards

const SHAPES = {
  mcq: { list: 'options', noun: 'options', one: 'option', min: 3, max: 4, correct: 'one' },
  desk: { list: 'options', noun: 'options', one: 'option', min: 3, max: 4, correct: 'one' },
  multi: { list: 'options', noun: 'options', one: 'option', min: 4, max: 6, correct: 'some' },
  variant: { list: 'options', noun: 'options', one: 'option', min: 4, max: 6, correct: 'some' },
  cloze: { list: 'chips', noun: 'chips', one: 'chip', min: 3, max: 4, correct: 'one' },
  match: { list: 'pairs', noun: 'pairs', one: 'pair', min: 3, max: 5 },
  order: { list: 'items', noun: 'items', one: 'item', min: 3, max: 6 },
  hotspot: { list: 'regions', noun: 'regions', one: 'region', min: 2, max: 7, correct: 'one' },
};

function entryNeeds(type, entry) {
  if (!isObject(entry)) return 'to be an object';
  switch (type) {
    case 'match':
      if (entry.id != null && !isId(entry.id)) return 'an id that is text';
      return isText(entry.left) && isText(entry.right) ? null : 'a left and a right';
    case 'order':
      return isId(entry.id) && isText(entry.text) && Number.isInteger(entry.position) ? null : 'an id, text and a position';
    case 'hotspot':
      if (!isId(entry.id) || !isText(entry.label) || typeof entry.correct !== 'boolean') return 'an id, a label and correct';
      return regionShape(entry) ? null : 'a shape: a rect, circle or polygon';
    case 'variant':
      return isId(entry.id) && isText(entry.text) && typeof entry.correct === 'boolean' && isText(entry.note)
        ? null
        : 'an id, text, correct and a note';
    default:
      return isId(entry.id) && isText(entry.text) && typeof entry.correct === 'boolean' ? null : 'an id, text and correct';
  }
}

// The problems with a card's own list: its count, its entries, its ids and its answers.
function shapeProblems(card, shape) {
  const list = card[shape.list];
  if (!Array.isArray(list)) return [MESSAGES.badCount(card.type, shape.noun, shape.min, shape.max, 0)];
  const out = [];
  if (list.length < shape.min || list.length > shape.max) {
    out.push(MESSAGES.badCount(card.type, shape.noun, shape.min, shape.max, list.length));
  }
  list.forEach((entry, i) => {
    const needs = entryNeeds(card.type, entry);
    if (needs) out.push(MESSAGES.badEntry(shape.one.charAt(0).toUpperCase() + shape.one.slice(1), i + 1, needs));
  });
  if (out.length > 0) return out;
  const ids = list.map((e, i) => (card.type === 'match' && e.id == null ? String(i + 1) : String(e.id)));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return [MESSAGES.sharedId(shape.noun, id)];
    seen.add(id);
  }
  const correct = list.filter((e) => e.correct === true).length;
  if (shape.correct === 'one' && correct !== 1) out.push(MESSAGES.oneCorrect(card.type, shape.one, correct));
  if (shape.correct === 'some' && correct < 1) out.push(MESSAGES.someCorrect(card.type));
  if (card.type === 'order') {
    const positions = list.map((e) => e.position).sort((a, b) => a - b);
    if (!positions.every((p, i) => p === i + 1)) out.push(MESSAGES.positions(list.length));
  }
  return out;
}

// Every glossary term id a card names.
export function cardTermRefs(card) {
  const refs = [];
  if (Array.isArray(card.glossaryRefs)) refs.push(...card.glossaryRefs);
  if (card.termRef != null) refs.push(card.termRef);
  for (const list of [card.options, card.chips]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (isObject(entry) && entry.termRef != null) refs.push(entry.termRef);
  }
  return refs;
}

function checkCard(card, add, warn, env) {
  const item = `card ${isText(card.cardId) ? card.cardId : '?'}`;
  if (!CARD_TYPES.includes(card.type)) {
    add(item, MESSAGES.unknownType(String(card.type)));
    return;
  }
  if (!isText(card.prompt)) add(item, MESSAGES.missing('prompt'));
  const testable = TESTABLE_TYPES.includes(card.type);
  if (testable && card.srsKey == null) add(item, MESSAGES.noSrsKey(card.type));
  if (!testable && card.srsKey != null) add(item, MESSAGES.teachSrsKey);
  if (testable && card.srsKey != null && !(isText(card.srsKey) && SRS_KEY.test(card.srsKey))) add(item, MESSAGES.badSrsKey);
  if (card.glossaryRefs != null && !Array.isArray(card.glossaryRefs)) add(item, MESSAGES.badList('glossaryRefs'));
  for (const field of ['feedback', 'trapFeedback']) if (card[field] != null && !isText(card[field])) add(item, MESSAGES.notText(field));
  if (card.trap != null && typeof card.trap !== 'boolean') add(item, MESSAGES.badBoolean('trap'));

  const shape = SHAPES[card.type];
  if (shape) for (const message of shapeProblems(card, shape)) add(item, message);
  if (card.type === 'cloze' && isText(card.prompt)) {
    const gaps = (card.prompt.match(/___/g) || []).length;
    if (gaps !== 1) add(item, MESSAGES.clozeGap(gaps));
  }
  if (card.type === 'variant' && !hasText(card.term)) add(item, MESSAGES.variantTerm);
  if (card.type === 'desk' && card.artifact != null) {
    const a = card.artifact;
    if (!isObject(a) || !ARTIFACT_KINDS.includes(a.kind) || !isText(a.text)) add(item, MESSAGES.badArtifact);
  }
  checkCardFigure(card, item, add, warn, env.figures);

  if (env.glossaryIds) {
    for (const ref of cardTermRefs(card)) if (!env.glossaryIds.has(ref)) add(item, MESSAGES.unknownTerm(String(ref)));
  }
}

function checkCardFigure(card, item, add, warn, figures) {
  const ref = card.figure;
  if (ref == null) {
    if (card.type === 'hotspot') add(item, MESSAGES.hotspotNoFigure);
    return;
  }
  let fig = ref;
  if (isText(ref)) {
    if (!Object.hasOwn(figures, ref)) {
      if (card.type === 'hotspot') add(item, MESSAGES.hotspotFigureMissing(ref));
      else warn(item, WARNINGS.figureNotInPack(ref));
      return;
    }
    fig = figures[ref];
  } else {
    const problem = figureProblem(ref);
    if (problem) {
      add(item, problem);
      return;
    }
  }
  if (!isObject(fig)) return; // reported with the pack's figures
  const frames = Array.isArray(fig.frames);
  if (frames && card.type !== 'teach') add(item, card.type === 'hotspot' ? MESSAGES.hotspotFrames : MESSAGES.framesOnlyTeach);
  if (card.type === 'hotspot' && !frames && !parseViewBox(fig.svg)) add(item, MESSAGES.hotspotViewBox);
}

// ------------------------------------------------------------------------------- packs

// The ids already taken outside this pack: lesson and card ids, each with where it is.
function takenIds(otherPacks) {
  const lessons = new Map();
  const cards = new Map();
  for (const pack of otherPacks) {
    const where = `the pack "${pack.title || pack.packId}"`;
    for (const lesson of Array.isArray(pack.lessons) ? pack.lessons : []) {
      if (!isObject(lesson)) continue;
      if (isText(lesson.lessonId)) lessons.set(lesson.lessonId, where);
      for (const card of Array.isArray(lesson.cards) ? lesson.cards : []) {
        if (isObject(card) && isText(card.cardId)) cards.set(card.cardId, where);
      }
    }
  }
  return { lessons, cards };
}

// env: { glossary (the glossary the pack's terms resolve in, or null), otherPacks }
function packProblems(pack, c, env) {
  const top = 'the pack';
  if (!(isText(pack.packId) && PACK_ID.test(pack.packId))) c.add(top, MESSAGES.badId('packId'));
  if (pack.contentClass !== 'public' && pack.contentClass !== 'private') c.add(top, MESSAGES.badClass);
  if (typeof pack.order !== 'number' || !Number.isFinite(pack.order)) c.add(top, MESSAGES.noOrder);
  if (!hasText(pack.title)) c.add(top, MESSAGES.missing('title'));
  if (pack.subtitle != null && !isText(pack.subtitle)) c.add(top, MESSAGES.notText('subtitle'));
  if (pack.authoredOn != null && !isDay(pack.authoredOn)) c.add(top, MESSAGES.badDay('authoredOn'));

  const figures = isObject(pack.figures) ? pack.figures : {};
  if (pack.figures != null && !isObject(pack.figures)) c.add(top, MESSAGES.badFigure);
  for (const [id, fig] of Object.entries(figures)) {
    const problem = figureProblem(fig);
    if (problem) c.add(`figure ${id}`, problem);
  }

  const lessons = Array.isArray(pack.lessons) ? pack.lessons : [];
  if (lessons.length === 0) {
    c.add(top, MESSAGES.noLessons);
    return;
  }
  const refs = lessons.some((l) => isObject(l) && Array.isArray(l.cards) && l.cards.some((card) => isObject(card) && cardTermRefs(card).length > 0));
  if (refs && !env.glossary) c.add(top, MESSAGES.noGlossary);
  const glossaryIds = env.glossary && Array.isArray(env.glossary.terms) ? new Set(env.glossary.terms.map((t) => t && t.id)) : null;

  const taken = takenIds(env.otherPacks);
  const lessonOrder = new Map();
  for (const lesson of lessons) {
    if (isObject(lesson) && isText(lesson.lessonId) && typeof lesson.order === 'number') lessonOrder.set(lesson.lessonId, lesson.order);
  }
  const seenLessons = new Set();
  const seenCards = new Set();
  let needsReview = 0;
  for (const lesson of lessons) {
    if (!isObject(lesson)) {
      c.add('a lesson', MESSAGES.missing('lessonId'));
      continue;
    }
    const item = `lesson ${isText(lesson.lessonId) ? lesson.lessonId : '?'}`;
    if (!isText(lesson.lessonId) || !PACK_ID.test(lesson.lessonId)) c.add(item, MESSAGES.badId('lessonId'));
    else if (seenLessons.has(lesson.lessonId)) c.add(item, MESSAGES.idTwice('lesson', lesson.lessonId));
    else if (taken.lessons.has(lesson.lessonId)) c.add(item, MESSAGES.idElsewhere('lesson', lesson.lessonId, taken.lessons.get(lesson.lessonId)));
    seenLessons.add(lesson.lessonId);
    if (typeof lesson.order !== 'number' || !Number.isFinite(lesson.order)) c.add(item, MESSAGES.noOrder);
    if (!hasText(lesson.title)) c.add(item, MESSAGES.missing('title'));
    const status = isObject(lesson.verification) ? lesson.verification.status : undefined;
    if (!STATUSES.includes(status)) c.add(item, MESSAGES.badStatus);
    if (status === 'needs-review') needsReview++;
    if (lesson.prerequisites != null) {
      if (!Array.isArray(lesson.prerequisites)) c.add(item, MESSAGES.badList('prerequisites'));
      else {
        for (const id of lesson.prerequisites) {
          const inPack = lessonOrder.has(id);
          const earlier = inPack ? lessonOrder.get(id) < lesson.order : taken.lessons.has(id);
          if (!earlier) c.add(item, MESSAGES.badPrerequisite(String(id)));
        }
      }
    }
    const cards = Array.isArray(lesson.cards) ? lesson.cards : [];
    if (cards.length === 0) c.add(item, MESSAGES.noCards);
    for (const card of cards) {
      if (!isObject(card)) {
        c.add(item, MESSAGES.missing('cardId'));
        continue;
      }
      const cardItem = `card ${isText(card.cardId) ? card.cardId : '?'}`;
      if (!isText(card.cardId) || !PACK_ID.test(card.cardId)) c.add(cardItem, MESSAGES.badId('cardId'));
      else if (seenCards.has(card.cardId)) c.add(cardItem, MESSAGES.idTwice('card', card.cardId));
      else if (taken.cards.has(card.cardId)) c.add(cardItem, MESSAGES.idElsewhere('card', card.cardId, taken.cards.get(card.cardId)));
      seenCards.add(card.cardId);
      checkCard(card, c.add, c.warn, { figures, glossaryIds: env.glossary ? glossaryIds : null });
    }
  }
  if (needsReview > 0) c.warn('', WARNINGS.needsReview(needsReview, 'lesson'));
}

// --------------------------------------------------------------------------- glossaries

function idList(list, field, c, validId, extra) {
  const ids = new Set();
  if (!Array.isArray(list)) {
    c.add('the glossary', MESSAGES.badList(field));
    return ids;
  }
  const kind = field.replace(/ies$/, 'y').replace(/s$/, '');
  for (const entry of list) {
    const id = isObject(entry) ? entry.id : undefined;
    const item = `${kind} ${isText(id) ? id : '?'}`;
    if (!isText(id) || !validId.test(id)) c.add(item, MESSAGES.badId('id'));
    else if (ids.has(id)) c.add(item, MESSAGES.idTwice(kind, id));
    ids.add(id);
    if (isObject(entry) && !hasText(entry.name)) c.add(item, MESSAGES.missing('name'));
    if (isObject(entry) && extra) extra(entry, item);
  }
  return ids;
}

// env: { installedGlossary, keptPacks } — the packs that stay installed alongside it.
function glossaryProblems(glossary, c, env) {
  if (glossary.authoredOn != null && !isDay(glossary.authoredOn)) c.add('the glossary', MESSAGES.badDay('authoredOn'));
  const domains = idList(glossary.domains, 'domains', c, TERM_ID);
  const familyDomain = new Map();
  const families = idList(glossary.families, 'families', c, TERM_ID, (family, item) => {
    if (!domains.has(family.domain)) c.add(item, MESSAGES.unknownRef('domain', String(family.domain)));
    if (typeof family.varianceRequired !== 'boolean') c.add(item, MESSAGES.badBoolean('varianceRequired'));
    familyDomain.set(family.id, family);
  });
  const categories = idList(glossary.categories, 'categories', c, TERM_ID);

  const terms = Array.isArray(glossary.terms) ? glossary.terms : [];
  if (!Array.isArray(glossary.terms)) c.add('the glossary', MESSAGES.badList('terms'));
  else if (terms.length === 0) c.add('the glossary', MESSAGES.noTerms);
  const termIds = new Set(terms.filter(isObject).map((t) => t.id));
  const seen = new Set();
  let needsReview = 0;
  for (const term of terms) {
    if (!isObject(term)) {
      c.add('a term', MESSAGES.missing('id'));
      continue;
    }
    const item = `term ${isText(term.id) ? term.id : '?'}`;
    if (!isText(term.id) || !TERM_ID.test(term.id)) c.add(item, MESSAGES.badId('id'));
    else if (seen.has(term.id)) c.add(item, MESSAGES.idTwice('term', term.id));
    seen.add(term.id);
    if (!hasText(term.term)) c.add(item, MESSAGES.missing('term'));
    if (!isText(term.definition)) c.add(item, MESSAGES.missing('definition'));
    if (!categories.has(term.category)) c.add(item, MESSAGES.unknownRef('category', String(term.category)));
    if (!domains.has(term.domain)) c.add(item, MESSAGES.unknownRef('domain', String(term.domain)));
    let family = null;
    if (term.family != null) {
      family = familyDomain.get(term.family) || null;
      if (!family) c.add(item, MESSAGES.unknownRef('family', String(term.family)));
      else if (family.domain !== term.domain) c.add(item, MESSAGES.familyDomain(term.family, String(term.domain)));
    }
    if (term.status !== 'active' && term.status !== 'retired') c.add(item, MESSAGES.badTermStatus);
    if (!isContentVersion(term.addedIn)) c.add(item, MESSAGES.badTermVersion('addedIn'));
    if (term.changedIn != null && !isContentVersion(term.changedIn)) c.add(item, MESSAGES.badTermVersion('changedIn'));
    if (!STATUSES.includes(term.verification)) c.add(item, MESSAGES.badVerification);
    if (term.verification === 'needs-review') needsReview++;
    if (term.deskRelevant != null && typeof term.deskRelevant !== 'boolean') c.add(item, MESSAGES.badBoolean('deskRelevant'));
    if (term.relatedIds != null) {
      if (!Array.isArray(term.relatedIds)) c.add(item, MESSAGES.badList('relatedIds'));
      else for (const id of term.relatedIds) if (!termIds.has(id)) c.add(item, MESSAGES.unknownRef('related term', String(id)));
    }
    for (const field of ['variants', 'notTheSameAs']) {
      const list = term[field];
      if (list == null) continue;
      if (!Array.isArray(list)) {
        c.add(item, MESSAGES.badList(field));
        continue;
      }
      for (const entry of list) {
        if (!isObject(entry) || !hasText(entry.term)) c.add(item, MESSAGES.missing(`${field} term`));
        else if (field === 'notTheSameAs' && entry.termId != null && !termIds.has(entry.termId)) {
          c.add(item, MESSAGES.unknownRef('termId', String(entry.termId)));
        }
      }
    }
    if (family && family.varianceRequired && (!Array.isArray(term.variants) || !Array.isArray(term.notTheSameAs))) {
      c.warn(item, WARNINGS.varianceUnchecked);
    }
  }
  if (needsReview > 0) c.warn('', WARNINGS.needsReview(needsReview, 'term'));

  // The update rules: nothing installed disappears, and installed packs still resolve.
  const installed = env.installedGlossary;
  if (installed && Array.isArray(installed.terms)) {
    for (const old of installed.terms) {
      if (isObject(old) && !termIds.has(old.id)) c.add('the glossary', MESSAGES.deletedTerm(String(old.id)));
    }
  }
  for (const pack of env.keptPacks) {
    for (const lesson of Array.isArray(pack.lessons) ? pack.lessons : []) {
      for (const card of isObject(lesson) && Array.isArray(lesson.cards) ? lesson.cards : []) {
        if (!isObject(card)) continue;
        for (const ref of cardTermRefs(card)) {
          if (!termIds.has(ref)) c.add('the glossary', MESSAGES.installedRef(pack.title || pack.packId, card.cardId, String(ref)));
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------ tracks

function trackProblems(track, c) {
  const top = 'the track';
  if (!(isText(track.trackId) && TRACK_ID.test(track.trackId))) c.add(top, MESSAGES.badId('trackId'));
  if (!hasText(track.title)) c.add(top, MESSAGES.missing('title'));
  if (track.role != null && !isText(track.role)) c.add(top, MESSAGES.notText('role'));
  if (!Array.isArray(track.packs) || track.packs.length === 0) {
    c.add(top, MESSAGES.noTrackPacks);
    return;
  }
  const seen = new Set();
  for (const id of track.packs) {
    if (!isText(id) || !PACK_ID.test(id)) c.add(top, MESSAGES.badId('packs'));
    else if (seen.has(id)) c.add(top, MESSAGES.packTwice(id));
    seen.add(id);
  }
}

// -------------------------------------------------------------------------- the checks

const installedPacks = (installed) => Object.values(installed.packs || {});

export function checkPack(pack, ctx) {
  if (olderFormat('pack', pack)) return stopped(MESSAGES.olderPack);
  const engine = engineProblem('pack', pack, ctx.engineVersion);
  if (engine) return stopped(engine);
  const version = versionProblem('pack', 'pack', pack, ctx.installed, false);
  if (version) return stopped(version);
  const c = collector();
  packProblems(pack, c, {
    glossary: ctx.installed.glossary,
    otherPacks: installedPacks(ctx.installed).filter((p) => p.packId !== pack.packId),
  });
  return finished(c);
}

export function checkGlossary(glossary, ctx) {
  if (olderFormat('glossary', glossary)) return stopped(MESSAGES.olderGlossary);
  const engine = engineProblem('glossary', glossary, ctx.engineVersion);
  if (engine) return stopped(engine);
  const version = versionProblem('glossary', 'glossary', glossary, ctx.installed, false);
  if (version) return stopped(version);
  const c = collector();
  glossaryProblems(glossary, c, { installedGlossary: ctx.installed.glossary, keptPacks: installedPacks(ctx.installed) });
  return finished(c);
}

export function checkTrack(track, ctx) {
  const engine = engineProblem('track', track, ctx.engineVersion);
  if (engine) return stopped(engine);
  const version = versionProblem('track', 'track', track, ctx.installed, false);
  if (version) return stopped(version);
  const c = collector();
  trackProblems(track, c);
  return finished(c);
}

// What a bundle would leave missing if it were taken as already installed: true when any
// of its parts isn't on the phone.
function bundleHasMissingParts(bundle, installed) {
  if (isObject(bundle.glossary) && !installed.glossary) return true;
  if (isObject(bundle.track) && !(installed.track && installed.track.trackId === bundle.track.trackId)) return true;
  const packs = Array.isArray(bundle.packs) ? bundle.packs : [];
  return packs.some((p) => isObject(p) && !Object.hasOwn(installed.packs, p.packId));
}

export function checkBundle(bundle, ctx) {
  const { installed, engineVersion } = ctx;
  const packs = Array.isArray(bundle.packs) ? bundle.packs : [];
  const parts = [];
  if (isObject(bundle.glossary) && Object.hasOwn(bundle.glossary, 'glossaryVersion')) parts.push(['glossary', 'glossary', bundle.glossary]);
  for (const pack of packs) {
    if (isObject(pack) && Object.hasOwn(pack, 'packId')) parts.push(['pack', `pack ${isText(pack.packId) ? pack.packId : '?'}`, pack]);
  }
  if (isObject(bundle.track) && Object.hasOwn(bundle.track, 'trackId')) parts.push(['track', 'track', bundle.track]);

  // 1. Older formats, in any part.
  for (const [kind, noun, data] of parts) if (olderFormat(kind, data)) return stopped(MESSAGES.olderPart(noun));
  // 2. engineMin, the bundle's own and each part's.
  const engine = engineProblem('bundle', bundle, engineVersion);
  if (engine) return stopped(engine);
  for (const [, noun, data] of parts) {
    const problem = engineProblem(`bundle's ${noun}`, data, engineVersion);
    if (problem) return stopped(problem);
  }
  // 3. Versions. The same bundle again is already installed unless a part has gone.
  if (!isContentVersion(bundle.bundleVersion)) return stopped(MESSAGES.badVersion('bundle'));
  const twin = installed.bundle && installed.bundle.bundleId === bundle.bundleId ? installed.bundle : null;
  if (twin && isContentVersion(twin.bundleVersion)) {
    const order = compareVersions(bundle.bundleVersion, twin.bundleVersion);
    if (order < 0) return stopped(MESSAGES.older('bundle', bundle.bundleVersion, twin.bundleVersion));
    if (order === 0 && !bundleHasMissingParts(bundle, installed)) return stopped(MESSAGES.alreadyInstalled('bundle', bundle.bundleVersion));
  }
  for (const [kind, noun, data] of parts) {
    const problem = versionProblem(kind, `bundle's ${noun}`, data, installed, true);
    if (problem) return stopped(problem);
  }

  // 4. Everything else, the parts checked together.
  const c = collector();
  const top = 'the bundle';
  if (!(isText(bundle.bundleId) && TRACK_ID.test(bundle.bundleId))) c.add(top, MESSAGES.badId('bundleId'));
  if (!hasText(bundle.title)) c.add(top, MESSAGES.missing('title'));
  if (bundle.reportPrefix != null && !(isText(bundle.reportPrefix) && PREFIX.test(bundle.reportPrefix))) c.add(top, MESSAGES.badPrefix);
  if (bundle.createdOn != null && !isDay(bundle.createdOn)) c.add(top, MESSAGES.badDay('createdOn'));
  if (!isObject(bundle.glossary) || !Object.hasOwn(bundle.glossary, 'glossaryVersion')) c.add(top, MESSAGES.notPart('glossary'));
  if (!isObject(bundle.track) || !Object.hasOwn(bundle.track, 'trackId')) c.add(top, MESSAGES.notPart('track'));
  if (!Array.isArray(bundle.packs) || packs.length === 0) c.add(top, MESSAGES.noBundlePacks);
  const bundlePackIds = new Set();
  for (const pack of packs) {
    if (!isObject(pack) || !Object.hasOwn(pack, 'packId')) c.add(top, MESSAGES.notPart('pack'));
    else if (bundlePackIds.has(pack.packId)) c.add(top, MESSAGES.packInBundleTwice(String(pack.packId)));
    else bundlePackIds.add(pack.packId);
  }
  if (bundle.ai != null) {
    const models = isObject(bundle.ai) && Array.isArray(bundle.ai.models) ? bundle.ai.models : [];
    for (const model of models) {
      if (isObject(model) && isText(model.id) && model.id.endsWith(':free') && model.private === true) {
        c.add(top, MESSAGES.freePrivate(model.id));
      }
    }
  }

  const glossary = isObject(bundle.glossary) && Object.hasOwn(bundle.glossary, 'glossaryVersion') ? bundle.glossary : installed.glossary;
  const keptPacks = installedPacks(installed).filter((p) => !bundlePackIds.has(p.packId));
  if (glossary === bundle.glossary) {
    glossaryProblems(bundle.glossary, collectInto(c, 'glossary'), { installedGlossary: installed.glossary, keptPacks });
  }
  const allBundlePacks = packs.filter((p) => isObject(p) && Object.hasOwn(p, 'packId'));
  for (const pack of allBundlePacks) {
    const others = [...keptPacks, ...allBundlePacks.filter((p) => p !== pack)];
    packProblems(pack, collectInto(c, `pack ${pack.packId}`), { glossary, otherPacks: others });
  }
  if (isObject(bundle.track) && Object.hasOwn(bundle.track, 'trackId')) trackProblems(bundle.track, collectInto(c, 'track'));
  return finished(c);
}

// A collector that files its problems into another, each item prefixed with the part.
function collectInto(outer, prefix) {
  const label = (item) => (item ? `${prefix}, ${item}` : prefix);
  return {
    add: (item, message) => outer.add(label(item), message),
    warn: (item, message) => outer.warn(label(item), message),
  };
}

export function checkFile(kind, data, ctx) {
  switch (kind) {
    case 'pack':
      return checkPack(data, ctx);
    case 'glossary':
      return checkGlossary(data, ctx);
    case 'track':
      return checkTrack(data, ctx);
    case 'bundle':
      return checkBundle(data, ctx);
    default:
      throw new Error(`no check for ${kind}`);
  }
}
