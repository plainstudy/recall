// Small helpers for building the page. Imported text always goes in as text, never as
// markup; the one span it may carry, between backticks, becomes a <code> element.
import { textSpans } from '../engine/text.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

// el('button', { class: 'x', text: 'Check', onclick }, ...children)
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Content text as nodes: plain parts as text, backtick spans as <code>.
export function richText(text) {
  return textSpans(text).map((span) => (span.mono ? el('code', { text: span.text }) : document.createTextNode(span.text)));
}

// A block of content text, line breaks kept.
export function textBlock(tag, cls, text) {
  return el(tag, { class: cls }, richText(text));
}

const ICONS = {
  right: 'M5 12.5l4.5 4.5L19 7.5',
  wrong: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  // The four places, and the session menu.
  home: 'M4 11.5L12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  library: 'M5 4.5h4v15H5zM10.5 4.5h4v15h-4zM16 5.6l3.6-1 3 14.6-3.6 1z',
  glossary: 'M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l5 5',
  settings: 'M4 7.5h9M17 7.5h3M15 5.5v4M4 16.5h3M11 16.5h9M9 14.5v4',
  menu: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
};

// The tick or cross that goes with every right or wrong mark, so colour never carries the
// meaning alone; and the few drawings the screens use. Hidden from screen readers, so each
// sits beside words or inside a control that has its own name.
export function icon(kind) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: `icon icon-${kind}`, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('path', { d: ICONS[kind] }));
  return svg;
}

// Marks an answer control after Check: right, wrong, or missed (a right answer that
// wasn't chosen on a multiple-choice card).
export function markAs(node, kind) {
  node.classList.add(`mark-${kind}`);
  node.append(icon(kind === 'wrong' ? 'wrong' : 'right'));
}
