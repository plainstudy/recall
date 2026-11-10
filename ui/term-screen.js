// One term on one screen (spec §7, item 5): its name and markers, its definition, how it
// is said, its other names with who uses them and their notes, its near-miss warnings with
// their reasons, and its related terms, all without a second tap. This is the glossary's
// main layout, the one the Desk mirrors.
import { el, textBlock } from './dom.js';
import { screenFoot } from './nav-bar.js';

// view: engine/search.js's termView. onOpenTerm(id) opens a related term; onBack returns
// to the search as it was left.
export function termScreen({ view, onOpenTerm, onBack, onPlace }) {
  const section = (kind, label, ...children) => el('section', { class: `term-section term-section-${kind}` }, el('h2', { text: label }), ...children);
  const markers = [
    view.markers.needsReview ? el('span', { class: 'marker marker-review', text: 'Needs review' }) : null,
    view.markers.variantsUnchecked ? el('span', { class: 'marker marker-review', text: 'Variants not yet checked' }) : null,
    view.markers.retired ? el('span', { class: 'marker marker-current', text: 'Retired' }) : null,
  ].filter(Boolean);
  const where = [view.domain, view.family, view.category].filter(Boolean).join(' · ');
  return el(
    'section',
    { class: 'screen place-screen term-screen', 'data-term-id': view.id },
    textBlock('h1', 'term-heading', view.name),
    view.expansion ? textBlock('p', 'term-expansion', view.expansion) : null,
    markers.length > 0 ? el('p', { class: 'term-markers' }, markers) : null,
    view.definition ? section('definition', 'Definition', textBlock('p', 'term-definition', view.definition)) : null,
    view.spoken ? section('spoken', 'How it is said', textBlock('p', 'term-spoken', view.spoken)) : null,
    view.variants.length > 0
      ? section(
          'variants',
          'Other names',
          el(
            'ul',
            { class: 'variant-list' },
            view.variants.map((v) =>
              el('li', { class: 'term-variant' }, textBlock('p', 'variant-name', v.name), v.usedBy ? textBlock('p', 'variant-used', v.usedBy) : null, v.note ? textBlock('p', 'variant-note', v.note) : null),
            ),
          ),
        )
      : null,
    view.nearMisses.length > 0
      ? section(
          'warnings',
          'Not the same as',
          el(
            'ul',
            { class: 'warning-list' },
            view.nearMisses.map((n) => el('li', { class: 'term-warning' }, textBlock('p', 'warning-line', n.warning), n.why ? textBlock('p', 'warning-why', n.why) : null)),
          ),
        )
      : null,
    view.related.length > 0
      ? section('related', 'Related terms', el('div', { class: 'related-list' }, view.related.map((r) => el('button', { type: 'button', class: 'secondary related', text: r.name, onclick: () => onOpenTerm(r.id) }))))
      : null,
    where ? el('p', { class: 'term-where', text: where }) : null,
    screenFoot('glossary', onPlace, el('button', { type: 'button', class: 'secondary', text: 'Back', onclick: onBack })),
  );
}
