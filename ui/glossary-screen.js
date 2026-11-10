// The Glossary place: the terms a learner may see, by name. Search, the filters and the
// term screen come with the glossary's own commit.
import { filterTerms } from '../engine/glossary.js';
import { el, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

export function glossaryScreen({ glossary, onPlace }) {
  const terms = glossary ? filterTerms(glossary).sort((a, b) => String(a.term).localeCompare(String(b.term))) : [];
  return el(
    'section',
    { class: 'screen place-screen glossary-screen' },
    el('h1', { class: 'screen-title', text: 'Glossary' }),
    glossary ? el('ul', { class: 'term-names' }, terms.map((t) => textBlock('li', 'term-name', t.term))) : el('p', { class: 'lead', text: 'No glossary installed yet. Import a bundle in Settings.' }),
    screenFoot('glossary', onPlace),
  );
}
