// The glossary as the engine uses it: what an update changes, and the terms filtered and
// grouped by whatever domains, families and categories the file itself defines. Nothing
// here names a domain, family or category.

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const termsOf = (glossary) => (isObject(glossary) && Array.isArray(glossary.terms) ? glossary.terms.filter(isObject) : []);

// JSON with its keys sorted, so two objects compare by content alone.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// What importing `next` over `installed` changes. A term is new when its id wasn't
// installed, retired when its status became retired in this file, and changed when any
// other installed term differs in any field.
export function glossaryChanges(installed, next) {
  const before = new Map(termsOf(installed).map((t) => [t.id, t]));
  const counts = { new: 0, changed: 0, retired: 0 };
  for (const term of termsOf(next)) {
    const old = before.get(term.id);
    if (!old) counts.new++;
    else if (term.status === 'retired' && old.status !== 'retired') counts.retired++;
    else if (canonical(old) !== canonical(term)) counts.changed++;
  }
  return counts;
}

// "with 1 new, 1 changed and 1 retired"
export const changesText = (c) => `with ${c.new} new, ${c.changed} changed and ${c.retired} retired`;

// A term by its id, retired or not.
export const termById = (glossary, id) => termsOf(glossary).find((t) => t.id === id) || null;

// The file's own lists, for filters.
export function taxonomy(glossary) {
  const list = (key) => (isObject(glossary) && Array.isArray(glossary[key]) ? glossary[key].filter(isObject) : []);
  return { domains: list('domains'), families: list('families'), categories: list('categories') };
}

// The terms a learner may see: never unverified, retired only when asked for, and narrowed
// to a domain, family or category of the file's when one is given.
export function filterTerms(glossary, { domain = null, family = null, category = null, showRetired = false } = {}) {
  return termsOf(glossary).filter(
    (t) =>
      t.verification !== 'unverified' &&
      (showRetired || t.status !== 'retired') &&
      (domain == null || t.domain === domain) &&
      (family == null || t.family === family) &&
      (category == null || t.category === category),
  );
}

const GROUP_LISTS = { domain: 'domains', family: 'families', category: 'categories' };

// The visible terms grouped by domain, family or category, in the order the file lists
// them, each group with the file's name for it. Terms with no family form a last group
// whose id and name are null.
export function groupTerms(glossary, by, options = {}) {
  const terms = filterTerms(glossary, options);
  const groups = taxonomy(glossary)[GROUP_LISTS[by]].map((g) => ({
    id: g.id,
    name: g.name,
    terms: terms.filter((t) => t[by] === g.id),
  }));
  const loose = terms.filter((t) => t[by] == null);
  if (loose.length > 0) groups.push({ id: null, name: null, terms: loose });
  return groups.filter((g) => g.terms.length > 0);
}
