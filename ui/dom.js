// Small helpers for building the page. Imported text always goes in as text, never as
// markup; the one span it may carry, between backticks, becomes a <code> element.
import { textSpans } from '../engine/text.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(node, children) {
  for (const child of children.flat()) {
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
};

// The tick or cross that goes with every right or wrong mark, so colour never carries the
// meaning alone.
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
