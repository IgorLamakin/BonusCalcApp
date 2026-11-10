'use strict';

/**
 * Генерация иконок из вашего логотипа icon.png (в корне проекта).
 *
 *   npm run icon
 *
 * Скрипт находит границы логотипа (убирает поля листа), вырезает квадрат,
 * добавляет отступ, скругляет углы и записывает:
 *   build/icon.png, build/logo.png, build/icon.ico,
 *   assets/icon.png, assets/logo.png
 *
 * Без внешних зависимостей — только Node.js.
 */

const fs = require('fs');
const path = require('path');
const {
  decodePng,
  cropRect,
  padImage,
  extractCenter,
  boxResize,
  roundCorners,
  writeIconSet
} = require('./lib/image');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ASSETS_DIR = path.join(ROOT, 'assets');
const SOURCE = path.join(ROOT, 'icon.png');

/**
 * Границы содержимого: если фон прозрачный — по альфе, если нет — по отличию
 * от цвета углов (логотип на белом листе A4).
 */
function findBoundingBox(rgba, width, height) {
  const alphaThreshold = 32;
  let transparent = 0;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] < 200) transparent++;
  }
  const transparentBackground = transparent / (width * height) > 0.1;

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)]
  ];

  let fr = 0;
  let fg = 0;
  let fb = 0;
  let count = 0;
  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 200) continue;
    fr += rgba[i];
    fg += rgba[i + 1];
    fb += rgba[i + 2];
    count++;
  }
  const background = count > 0 ? { r: fr / count, g: fg / count, b: fb / count } : null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let isContent;
      if (transparentBackground) {
        isContent = rgba[i + 3] > alphaThreshold;
      } else if (background) {
        const distance =
          Math.abs(rgba[i] - background.r) +
          Math.abs(rgba[i + 1] - background.g) +
          Math.abs(rgba[i + 2] - background.b);
        isContent = distance > 60;
      } else {
        isContent = rgba[i + 3] > alphaThreshold;
      }
      if (!isContent) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Не найден ${SOURCE} — положите логотип в корень проекта.`);
    process.exit(1);
  }

  const source = decodePng(fs.readFileSync(SOURCE));
  console.log(`Исходник: ${source.width}x${source.height}`);

  const box = findBoundingBox(source.rgba, source.width, source.height);
  if (!box) {
    console.error('Изображение полностью прозрачно — иконку сделать нельзя.');
    process.exit(1);
  }

  const boxWidth = box.maxX - box.minX + 1;
  const boxHeight = box.maxY - box.minY + 1;
  console.log(`Область логотипа: ${boxWidth}x${boxHeight}`);

  const cropped = cropRect(source.rgba, source.width, box.minX, box.minY, boxWidth, boxHeight);

  const pad = Math.max(8, Math.round(Math.max(boxWidth, boxHeight) * 0.1));
  const padded = padImage(cropped, boxWidth, boxHeight, pad, pad);

  const square = extractCenter(padded.rgba, padded.width, padded.height);
  const resized = boxResize(square.rgba, square.size, 512);
  const rounded = roundCorners(resized, 512, 42);

  const result = writeIconSet(rounded, { buildDir: BUILD_DIR, assetsDir: ASSETS_DIR });
  console.log('Готово:');
  console.log(`  build/icon.png   ${result.pngSize} байт`);
  console.log(`  build/icon.ico   ${result.icoSize} байт`);
  console.log('  assets/icon.png, assets/logo.png');
}

main();
