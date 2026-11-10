// Glossary search (spec §7, item 5), as pure functions. Names are matched ignoring case,
// accents and punctuation: every typed word must match the start of a word of the name,
// and an abbreviation also matches with its punctuation removed, so "BP" finds "B/P".
// Term names, variant names, near-miss names and expansions are all searched, and results
// run: exact name, then terms, variants, near-misses, expansions. Also here: a term on its
// own screen, and the requests for terms the glossary lacks.
import { filterTerms, taxonomy, termById } from './glossary.js';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x) => (typeof x === 'string' ? x : '');
const NOT_WORD = /[^\p{L}\p{N}]/gu;

// Lower case, with accents taken off.
export const fold = (value) => text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// A name's words: its parts between spaces and punctuation, and each part between spaces
// with its punctuation taken out. "B/P" gives b, p and bp; "Baker's" gives baker, s, bakers.
export function wordsOf(name) {
  const words = new Set();
  for (const chunk of fold(name).split(/\s+/).filter(Boolean)) {
    for (const part of chunk.split(NOT_WORD).filter(Boolean)) words.add(part);
    const squashed = chunk.replace(NOT_WORD, '');
    if (squashed) words.add(squashed);
  }
  return [...words];
}

// What was typed, as words, each without its punctuation.
export const typedWords = (typed) =>
  fold(typed)
    .split(/\s+/)
    .map((word) => word.replace(NOT_WORD, ''))
    .filter(Boolean);

// The whole of a name, folded, without spaces or punctuation: what an exact match compares.
const whole = (name) => fold(name).replace(NOT_WORD, '');

// True when every typed word starts one of the name's words.
export function nameMatches(name, words) {
  if (words.length === 0 || !text(name).trim()) return false;
  const own = wordsOf(name);
  return words.every((word) => own.some((w) => w.startsWith(word)));
}

const KIND_ORDER = { term: 0, variant: 1, 'near-miss': 2, expansion: 3 };
const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

// The warning a near-miss carries: "Poolish: not the same as Levain."
export const warningOf = (nearMiss, term) => `${text(nearMiss.term)}: not the same as ${text(term.term)}.`;

// The terms a learner may see under these filters, A to Z: what the Glossary lists before
// anything is typed. options: { domain, family, category, showRetired }.
export function listTerms(glossary, options = {}) {
  return filterTerms(glossary, options).sort((a, b) => byName(text(a.term), text(b.term)));
}

// The results for what was typed: [{ kind, name, term, exact, usedBy, why, warning }], where
// kind is 'term', 'variant', 'near-miss' or 'expansion', name is what matched, and term is
// the term the result belongs to. Exact names come first, then each kind in turn, each
// A to Z. Unverified terms are never searched, retired ones only when shown, and the
// filters apply.
export function searchGlossary(glossary, typed, options = {}) {
  const words = typedWords(typed);
  if (words.length === 0) return [];
  const target = whole(typed);
  const results = [];
  for (const term of filterTerms(glossary, options)) {
    const add = (kind, name, more = {}) => {
      if (nameMatches(name, words)) results.push({ kind, name: text(name), term, exact: whole(name) === target, ...more });
    };
    add('term', term.term);
    for (const variant of Array.isArray(term.variants) ? term.variants.filter(isObject) : []) add('variant', variant.term, { usedBy: text(variant.usedBy) });
    for (const near of Array.isArray(term.notTheSameAs) ? term.notTheSameAs.filter(isObject) : []) {
      add('near-miss', near.term, { why: text(near.why), warning: warningOf(near, term) });
    }
    add('expansion', term.expansion);
  }
  return results.sort((a, b) => Number(b.exact) - Number(a.exact) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byName(a.name, b.name) || byName(text(a.term.term), text(b.term.term)));
}

// A term as its own screen shows it, everything at once: its name and expansion, its
// markers, its definition and how it is said, its other names with who uses them and
// their notes, the near-misses with their warnings and reasons, and the related terms a
// learner may see. The file's own names for its domain, family and category come too.
export function termView(glossary, termId) {
  const term = termById(glossary, termId);
  if (!term || term.verification === 'unverified') return null;
  const lists = taxonomy(glossary);
  const nameIn = (list, id) => (list.find((x) => x.id === id) || {}).name || null;
  const family = lists.families.find((f) => f.id === term.family) || null;
  const visible = new Set(listTerms(glossary, { showRetired: true }).map((t) => t.id));
  const checked = 'variants' in term && 'notTheSameAs' in term;
  return {
    id: term.id,
    name: text(term.term),
    expansion: text(term.expansion) || null,
    definition: text(term.definition) || null,
    spoken: text(term.spoken) || null,
    domain: nameIn(lists.domains, term.domain),
    family: family ? family.name || null : null,
    category: nameIn(lists.categories, term.category),
    markers: {
      needsReview: term.verification === 'needs-review',
      variantsUnchecked: Boolean(family && family.varianceRequired === true && !checked),
      retired: term.status === 'retired',
    },
    variants: (Array.isArray(term.variants) ? term.variants.filter(isObject) : []).map((v) => ({ name: text(v.term), usedBy: text(v.usedBy) || null, note: text(v.note) || null })),
    nearMisses: (Array.isArray(term.notTheSameAs) ? term.notTheSameAs.filter(isObject) : []).map((n) => ({
      name: text(n.term),
      warning: warningOf(n, term),
      why: text(n.why) || null,
      termId: typeof n.termId === 'string' && visible.has(n.termId) ? n.termId : null,
    })),
    related: (Array.isArray(term.relatedIds) ? term.relatedIds : [])
      .filter((id) => visible.has(id))
      .map((id) => ({ id, name: text(termById(glossary, id).term) })),
  };
}

// True when the same request is already waiting for the next weekly report.
export function isRequested(progress, typed) {
  const key = whole(typed);
  return key !== '' && progress.termRequests.some((r) => r.reportedOn == null && whole(r.text) === key);
}

// A request for a term the glossary lacks: the text as typed, trimmed, on this day, unless
// the same request is already waiting. The weekly report carries it, and saving the report
// marks it reported.
export function requestTerm(progress, typed, day) {
  const clean = text(typed).trim().replace(/\s+/g, ' ');
  if (clean === '' || isRequested(progress, clean)) return progress;
  return { ...progress, termRequests: [...progress.termRequests, { text: clean, on: day, reportedOn: null }] };
}
