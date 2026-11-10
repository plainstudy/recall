// Draws the app's icons from the logo image given on the command line: its letters in one
// colour on white, at 70% of the icon's width and centred, at 192 and 512 pixels, and as a
// maskable 512 whose letters stay inside the middle circle of 80%, the part every launcher
// shape keeps. Playwright's Chromium, already installed for the screen tests, decodes and
// scales the image, so nothing else is needed. The image itself never enters the repository.
//
//   node scripts/make-icons.mjs <logo.png>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Where the letters lie in the 2000 x 2000 image, and their colour, as measured.
const BOX = { left: 745, top: 874, right: 1260, bottom: 1054 };
const MARGIN = 12;
const INK = [0x1f, 0x39, 0x5a];
const SHARE = 0.7; // of the icon's width
const SAFE_RADIUS = 0.4; // of the icon's width: the maskable safe zone
const ICONS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

const source = process.argv[2];
if (!source) {
  console.error('Give the logo image to draw from: node scripts/make-icons.mjs <logo.png>');
  process.exit(1);
}

// Runs in the browser. Turns the box around the letters into a mask of ink in the letters'
// colour, finds the ink's tight bounds, and draws each icon. Returns each as base64 PNG data,
// with how far the letters' corners lie from the centre.
async function draw({ dataUrl, BOX, MARGIN, INK, SHARE, ICONS }) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const x0 = BOX.left - MARGIN;
  const y0 = BOX.top - MARGIN;
  const w = BOX.right - BOX.left + 1 + 2 * MARGIN;
  const h = BOX.bottom - BOX.top + 1 + 2 * MARGIN;
  const mask = new OffscreenCanvas(w, h);
  const mctx = mask.getContext('2d', { willReadFrequently: true });
  mctx.drawImage(img, -x0, -y0);
  const pixels = mctx.getImageData(0, 0, w, h);
  const d = pixels.data;

  // A pixel's ink is how far it lies from white towards the letters' colour. The faint
  // marks of the image's background are dropped, and near-solid ink is made solid.
  const span = Math.hypot(255 - INK[0], 255 - INK[1], 255 - INK[2]);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    let ink = 1 - Math.hypot(d[p] - INK[0], d[p + 1] - INK[1], d[p + 2] - INK[2]) / span;
    ink = ink < 0.04 ? 0 : ink > 0.96 ? 1 : ink;
    d[p] = INK[0];
    d[p + 1] = INK[1];
    d[p + 2] = INK[2];
    d[p + 3] = Math.round(ink * 255);
    if (ink >= 0.5) {
      const x = i % w;
      const y = Math.floor(i / w);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error('no letters were found where they were measured');
  mctx.putImageData(pixels, 0, 0);
  const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  const out = [];
  for (const icon of ICONS) {
    const canvas = new OffscreenCanvas(icon.size, icon.size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, icon.size, icon.size);
    const width = icon.size * SHARE;
    const height = (bounds.h * width) / bounds.w;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mask, bounds.x, bounds.y, bounds.w, bounds.h, (icon.size - width) / 2, (icon.size - height) / 2, width, height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    out.push({ file: icon.file, size: icon.size, maskable: icon.maskable, base64: btoa(binary), corner: Math.hypot(width / 2, height / 2) });
  }
  return { bounds, icons: out };
}

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const dataUrl = `data:image/png;base64,${(await readFile(source)).toString('base64')}`;
  const { bounds, icons } = await page.evaluate(draw, { dataUrl, BOX, MARGIN, INK, SHARE, ICONS });
  const folder = new URL('../icons/', import.meta.url);
  await mkdir(folder, { recursive: true });
  for (const icon of icons) {
    if (icon.maskable && icon.corner > icon.size * SAFE_RADIUS) {
      throw new Error(`${icon.file}: the letters reach ${icon.corner.toFixed(1)} px from the centre, outside the safe zone`);
    }
    await writeFile(new URL(icon.file, folder), Buffer.from(icon.base64, 'base64'));
    console.log(`Wrote icons/${icon.file}: ${icon.size} px, letters' corners ${icon.corner.toFixed(1)} px from the centre.`);
  }
  console.log(`Letters found at ${bounds.w} x ${bounds.h} px within the measured box.`);
} finally {
  await browser.close();
}
