// Writes the plain placeholder icons in icons/: a disc on the app's dark background at
// 192 and 512 pixels, and a maskable 512-pixel version with the disc inside the safe zone.
// No dependencies. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const BACKGROUND = [0x0e, 0x16, 0x20];
const DISC = [0x3f, 0xb0, 0x8c];
const SAMPLES = 4; // per axis, for smooth edges

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, radiusShare) {
  const centre = size / 2;
  const radius = size * radiusShare;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const dx = x + (sx + 0.5) / SAMPLES - centre;
          const dy = y + (sy + 0.5) / SAMPLES - centre;
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      }
      const share = inside / (SAMPLES * SAMPLES);
      for (let k = 0; k < 3; k++) {
        row[1 + x * 3 + k] = Math.round(BACKGROUND[k] * (1 - share) + DISC[k] * share);
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const folder = new URL('../icons/', import.meta.url);
mkdirSync(folder, { recursive: true });
writeFileSync(new URL('icon-192.png', folder), png(192, 0.3));
writeFileSync(new URL('icon-512.png', folder), png(512, 0.3));
writeFileSync(new URL('icon-maskable-512.png', folder), png(512, 0.22));
console.log('Wrote icons/icon-192.png, icons/icon-512.png and icons/icon-maskable-512.png');
