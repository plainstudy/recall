// Hotspot cards: the figure, with the regions drawn as the engine's own layer over it, in
// the figure's coordinates, so they never move. A tap chooses a region. Each region's label
// is its accessible name, and is shown in words after Check.
import { regionShape } from '../engine/cards.js';
import { plainText } from '../engine/text.js';
import { el, icon, richText, svgEl } from './dom.js';
import { figureView } from './figure.js';

function shapeElement(shape) {
  if (shape.kind === 'rect') {
    return svgEl('rect', { x: shape.x, y: shape.y, width: shape.width, height: shape.height });
  }
  if (shape.kind === 'circle') return svgEl('circle', { cx: shape.cx, cy: shape.cy, r: shape.r });
  const points = [];
  for (let i = 0; i < shape.points.length; i += 2) points.push(`${shape.points[i]},${shape.points[i + 1]}`);
  return svgEl('polygon', { points: points.join(' ') });
}

export function mountHotspot(card, lists, { body, changed }) {
  const figure = figureView({ ...card.resolvedFigure, layers: card.resolvedFigure.layers.slice(0, 1) });
  const [x, y, w, h] = card.resolvedFigure.viewBox;
  const layer = svgEl('svg', { class: 'figure-layer regions', viewBox: `${x} ${y} ${w} ${h}`, role: 'group' });
  figure.box.append(layer);
  body.append(figure.node);

  let chosen = null;
  let locked = false;
  const shapes = new Map();
  for (const region of card.regions) {
    const id = String(region.id);
    const node = shapeElement(regionShape(region));
    node.setAttribute('class', 'region');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute('aria-label', plainText(region.label) || 'Region');
    node.addEventListener('click', () => choose(id));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(id);
      }
    });
    shapes.set(id, node);
    layer.append(node);
  }

  function choose(id) {
    if (locked) return;
    chosen = id;
    for (const [other, node] of shapes) node.setAttribute('aria-pressed', String(other === chosen));
    changed();
  }

  return {
    answer: () => (chosen === null ? null : { choice: chosen }),
    // An answer given earlier, shown again as it was chosen.
    restore(given) {
      chosen = given && given.choice != null && shapes.has(String(given.choice)) ? String(given.choice) : null;
      for (const [other, node] of shapes) node.setAttribute('aria-pressed', String(other === chosen));
    },
    reveal(score) {
      locked = true;
      for (const [id, node] of shapes) {
        node.removeAttribute('tabindex');
        node.setAttribute('aria-disabled', 'true');
        if (score.right.includes(id)) node.classList.add('region-right');
        else if (id === chosen) node.classList.add('region-wrong');
      }
      const label = (id) => {
        const region = card.regions.find((r) => String(r.id) === id);
        return richText(region && region.label ? region.label : '');
      };
      const lines = score.right.map((id) => el('li', { class: 'key-line' }, icon('right'), el('span', {}, label(id))));
      if (!score.correct && chosen !== null) {
        lines.push(el('li', { class: 'key-line' }, icon('wrong'), el('span', {}, label(chosen))));
      }
      return el('ul', { class: 'answer-key answer-key-list' }, lines);
    },
  };
}
