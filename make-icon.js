/*
 * make-icon.js — генерирует дефолтную иконку приложения build/icon.png (512x512)
 * Без внешних зависимостей: минимальный PNG-энкодер (RGBA, zlib) + растеризация.
 * Запуск: node make-icon.js
 * Создает иконку с символом "%" на синем фоне.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 512; // размер
const C = 80;  // сглаживающая точность (мягкие края)

// --- цвета ---
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

const GRAD_TOP = [15, 52, 96];     // тёмно-синий
const GRAD_BOT = [37, 99, 235];    // насыщенный синий
const WHITE = [255, 255, 255];

// скруглённый квадрат — принадлежность точки
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  const d2 = dx * dx + dy * dy;
  const r2 = r * r;
  if (dx !== 0 && dy !== 0) return d2 <= r2 ? 1 : Math.max(0, (r - Math.sqrt(d2)) / 1.5);
  return 1;
}

// принадлежность точки отрезку с толщиной (для рисования линий "%")
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function inCircle(x, y, cx, cy, r) {
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, (r - d) / 1.5));
}

// читаемость "%": два круга + наклонная палка
function glyphPercent(x, y, fx) {
  const r = 46 * fx;
  const thick = 30 * fx;
  const topC = [x + 95 * fx, y - 100 * fx];
  const botC = [x - 95 * fx, y + 100 * fx];
  let a = inCircle(x, y, topC[0], topC[1], r);
  let b = inCircle(x, y, botC[0], botC[1], r);
  const bar = 1 - Math.min(1, distToSegment(x, y, x - 95 * fx, y - 100 * fx, x + 95 * fx, y + 100 * fx) / (thick / 2));
  a = Math.max(a, bar);
  return Math.max(a, b);
}

const img = Buffer.alloc(S * S * 4);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const nx = (x - S / 2) / S, ny = (y - S / 2) / S;
    const shape = inRoundRect(x, y, 24, 24, S - 24, S - 24, 108);
    const bg = mix(GRAD_TOP, GRAD_BOT, (y / S) * 0.75 + nx * 0.2);

    const gp = glyphPercent(x, y, S / 512);

    let r, g, b, a;
    if (gp > 0.02) {
      const shade = 0.98 - ny * 0.06;
      r = WHITE[0] * shade; g = WHITE[1] * shade; b = WHITE[2] * shade;
    } else {
      r = bg[0]; g = bg[1]; b = bg[2];
    }

    const alpha = Math.max(shape, gp) * 255;
    img[i + 0] = Math.round(Math.min(255, r));
    img[i + 1] = Math.round(Math.min(255, g));
    img[i + 2] = Math.round(Math.min(255, b));
    img[i + 3] = Math.round(Math.min(255, alpha));
  }
}

// --- PNG-энкодер ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  img.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, 'build');
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('OK: build/icon.png (' + png.length + ' bytes)');
