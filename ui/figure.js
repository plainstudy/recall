// Figures are drawn as images from data: URLs, so nothing inside one can run. A stepped
// figure shows its first frame, and each step adds the next frame on top. If a figure
// can't be drawn, its text alternative shows in its place.
import { el } from './dom.js';

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// figure: { layers, alt, viewBox } from the engine's resolveFigure.
export function figureView(figure) {
  const box = el('div', { class: 'figure-box' });
  if (figure.viewBox) {
    box.classList.add('figure-box-sized');
    box.style.aspectRatio = `${figure.viewBox[2]} / ${figure.viewBox[3]}`;
  }
  const node = el('figure', { class: 'figure' }, box);
  let shown = 0;

  const showAlt = () => {
    box.replaceWith(el('p', { class: 'figure-alt', text: figure.alt || 'The figure could not be drawn.' }));
  };

  const showNext = () => {
    if (shown >= figure.layers.length) return;
    const img = el('img', {
      class: 'figure-layer',
      src: svgDataUrl(figure.layers[shown]),
      alt: shown === 0 ? figure.alt : '',
      decoding: 'async',
    });
    img.addEventListener('error', showAlt, { once: true });
    box.append(img);
    shown++;
  };

  showNext();
  return { node, box, showNext, hasMore: () => shown < figure.layers.length };
}
