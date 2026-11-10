// The Glossary (spec §7, item 5): search, and filters by the file's own domains, families
// and categories; the results, each saying what matched and the term it belongs to, with
// a near-miss's warning shown in the results without opening the term; and Request this
// term at the end of every result list, or on its own when nothing matches. Before
// anything is typed, every term shows, A to Z. The search field is the screen's main
// action, in the bar at the bottom. Nothing here needs the network.
import { taxonomy } from '../engine/glossary.js';
import { listTerms, searchGlossary } from '../engine/search.js';
import { el, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

export const GLOSSARY_TEXT = {
  noGlossary: 'No glossary installed yet. Import a bundle in Settings.',
  noMatch: 'No term matches.',
  noTerms: 'No terms here.',
  requested: 'Requested. It goes into your next weekly report.',
};

const MAX_SEARCH = 60;

function termRow(term, onOpen) {
  return el(
    'li',
    {},
    el(
      'button',
      { type: 'button', class: 'result result-term', 'data-term-id': term.id, onclick: () => onOpen(term.id) },
      textBlock('span', 'result-name', term.term),
      term.expansion ? textBlock('span', 'result-note', term.expansion) : null,
    ),
  );
}

// One result: a term, or a variant or expansion with the term it belongs to, or a
// near-miss with its warning and the reason.
function resultRow(result, onOpen) {
  let lines;
  if (result.kind === 'term') lines = [textBlock('span', 'result-name', result.name), result.term.expansion ? textBlock('span', 'result-note', result.term.expansion) : null];
  else if (result.kind === 'near-miss') lines = [textBlock('span', 'result-name result-warning', result.warning), result.why ? textBlock('span', 'result-note', result.why) : null];
  else lines = [textBlock('span', 'result-name', `${result.name} → ${result.term.term}`), result.usedBy ? textBlock('span', 'result-note', result.usedBy) : null];
  return el(
    'li',
    {},
    el('button', { type: 'button', class: `result result-${result.kind}`, 'data-kind': result.kind, 'data-term-id': result.term.id, onclick: () => onOpen(result.term.id) }, lines),
  );
}

// state: { query, domain, family, category, showRetired }, kept while the app runs, so
// coming back from a term finds the search as it was left.
// onOpen(termId) opens a term. onRequest(text) resolves once the request is stored, and
// isRequested(text) says whether it is waiting for the next report.
export function glossaryScreen({ glossary, state, onOpen, onRequest, isRequested, onPlace }) {
  const heading = el('h1', { class: 'screen-title', text: 'Glossary' });
  if (!glossary) {
    return el('section', { class: 'screen place-screen glossary-screen' }, heading, el('p', { class: 'lead', text: GLOSSARY_TEXT.noGlossary }), screenFoot('glossary', onPlace));
  }

  const options = () => ({ domain: state.domain, family: state.family, category: state.category, showRetired: state.showRetired });
  const results = el('div', { class: 'results', 'aria-live': 'polite' });

  function requestLine(typed) {
    if (isRequested(typed)) return el('p', { class: 'request-done', role: 'status', text: GLOSSARY_TEXT.requested });
    return el('button', {
      type: 'button',
      class: 'secondary request',
      text: 'Request this term',
      onclick: async () => {
        await onRequest(typed);
        render();
      },
    });
  }

  function render() {
    const typed = state.query.trim();
    const parts = [];
    if (typed === '') {
      const terms = listTerms(glossary, options());
      parts.push(terms.length > 0 ? el('ul', { class: 'result-list' }, terms.map((term) => termRow(term, onOpen))) : el('p', { class: 'no-match', text: GLOSSARY_TEXT.noTerms }));
    } else {
      const found = searchGlossary(glossary, typed, options());
      parts.push(found.length > 0 ? el('ul', { class: 'result-list' }, found.map((r) => resultRow(r, onOpen))) : el('p', { class: 'no-match', text: GLOSSARY_TEXT.noMatch }));
      parts.push(requestLine(typed));
    }
    results.replaceChildren(...parts);
  }

  // A filter by one of the file's own lists; left out when the file lists nothing.
  function filter(key, label, list) {
    if (list.length === 0) return null;
    const node = el(
      'select',
      { class: `filter filter-${key}`, 'aria-label': label },
      el('option', { value: '', text: `All ${label.toLowerCase()}` }),
      list.map((item) => el('option', { value: item.id, text: item.name || item.id })),
    );
    node.value = list.some((item) => item.id === state[key]) ? state[key] : '';
    node.addEventListener('change', () => {
      state[key] = node.value || null;
      render();
    });
    return node;
  }

  const lists = taxonomy(glossary);
  const retired = el('button', {
    type: 'button',
    class: 'toggle show-retired',
    'aria-pressed': String(state.showRetired),
    text: 'Show retired',
    onclick: () => {
      state.showRetired = !state.showRetired;
      retired.setAttribute('aria-pressed', String(state.showRetired));
      render();
    },
  });

  const search = el('input', {
    type: 'search',
    class: 'search-field',
    'aria-label': 'Search the glossary',
    placeholder: 'Search terms',
    maxlength: String(MAX_SEARCH),
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    value: state.query,
  });
  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') search.blur();
  });

  render();
  return el(
    'section',
    { class: 'screen place-screen glossary-screen' },
    heading,
    el('div', { class: 'filters' }, filter('domain', 'Domains', lists.domains), filter('family', 'Families', lists.families), filter('category', 'Categories', lists.categories), retired),
    results,
    screenFoot('glossary', onPlace, search),
  );
}
