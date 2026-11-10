'use strict';

/**
 * Запасная иконка приложения — синий квадрат со знаком «%».
 * Нужна, если своего логотипа нет.
 *
 *   npm run icon-default
 *
 * Записывает тот же набор файлов, что и process-logo.js.
 */

const path = require('path');
const { writeIconSet } = require('./lib/image');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSETS_DIR = path.join(ROOT, 'assets');
const SIZE = 512;

const GRADIENT_TOP = [15, 52, 96];
const GRADIENT_BOTTOM = [37, 99, 235];
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function roundRectCoverage(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  if (dx !== 0 && dy !== 0) {
    const distance = Math.hypot(dx, dy);
    return distance <= r ? 1 : Math.max(0, (r - distance) / 1.5);
  }
  return 1;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function circleCoverage(x, y, cx, cy, r) {
  const distance = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, (r - distance) / 1.5));
}

function percentGlyph(x, y, scale) {
  const radius = 46 * scale;
  const thickness = 30 * scale;
  const top = circleCoverage(x, y, x + 95 * scale, y - 100 * scale, radius);
  const bottom = circleCoverage(x, y, x - 95 * scale, y + 100 * scale, radius);
  const bar =
    1 -
    Math.min(
      1,
      distanceToSegment(x, y, x - 95 * scale, y - 100 * scale, x + 95 * scale, y + 100 * scale) /
        (thickness / 2)
    );
  return Math.max(top, bottom, bar);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 512;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x - size / 2) / size;
      const ny = (y - size / 2) / size;
      const shape = roundRectCoverage(
        x,
        y,
        24 * scale,
        24 * scale,
        size - 24 * scale,
        size - 24 * scale,
        108 * scale
      );
      const background = mix(GRADIENT_TOP, GRADIENT_BOTTOM, (y / size) * 0.75 + nx * 0.2);
      const glyph = percentGlyph(x, y, scale);

      let color;
      if (glyph > 0.02) {
        const shade = 0.98 - ny * 0.06;
        color = [WHITE[0] * shade, WHITE[1] * shade, WHITE[2] * shade];
      } else {
        color = background;
      }

      rgba[i] = Math.round(Math.min(255, color[0]));
      rgba[i + 1] = Math.round(Math.min(255, color[1]));
      rgba[i + 2] = Math.round(Math.min(255, color[2]));
      rgba[i + 3] = Math.round(Math.min(255, Math.max(shape, glyph) * 255));
    }
  }

  return rgba;
}

const result = writeIconSet(renderIcon(SIZE), { buildDir: BUILD_DIR, assetsDir: ASSETS_DIR });
console.log(`Готово: build/icon.png ${result.pngSize} байт, build/icon.ico ${result.icoSize} байт`);
