/*
 * process-logo.js — берёт user-логотип C:\BonusCalcApp\icon.png (A4-лист)
 * и создаёт из него квадратный логотип + Windows-иконку:
 *   build/icon.png  — 512x512 квадрат (используется окном приложения)
 *   build/logo.png  — 512x512 квадрат (используется в UI-шапке)
 *   build/icon.ico  — многоразмерная Windows-иконка
 *
 * Реальная обработка: центральная обрезка до квадрата + суперсемплированный
 * ресайз + мягкое скругление углов. Без внешних зависимостей (чистый Node).
 * Запуск: node process-logo.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ======================= PNG-декодер (в RGBA) =======================
// Поддержка: color type 0 (grayscale), 2 (RGB), 3 (palette),
// 4 (grayscale+alpha), 6 (RGBA). Bit depth 8.
function decodePng(buf) {
  if (buf.length < 33 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Не PNG-файл');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error('Поддерживается только bit depth 8 или 16, получено: ' + bitDepth);
  }

  let off = 8, idat = [];
  let palette = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  let channels;
  switch (colorType) {
    case 0: channels = 1; break;
    case 2: channels = 3; break;
    case 3: channels = 1; break;
    case 4: channels = 2; break;
    case 6: channels = 4; break;
    default: throw new Error('Неподдерживаемый color type: ' + colorType);
  }

  const bytesPerChannel = bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = channels * bytesPerChannel;
  const stride = width * bytesPerPixel;
  const samples = Buffer.alloc(height * stride);
  const prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.slice(pos, pos + stride);
    pos += stride;
    for (let x = 0; x < stride; x++) {
      let v = row[x];
      const L = x >= bytesPerPixel ? samples[y * stride + x - bytesPerPixel] : 0;
      const U = prev[x];
      const UL = (x >= bytesPerPixel && y > 0) ? prev[x - bytesPerPixel] : 0;
      if (filter === 1) v += L;
      else if (filter === 2) v += U;
      else if (filter === 3) v += Math.floor((L + U) / 2);
      else if (filter === 4) {
        const p = L + U - UL, pa = Math.abs(p - L), pb = Math.abs(p - U), pc = Math.abs(p - UL);
        v += pa <= pb && pa <= pc ? L : pb <= pc ? U : UL;
      }
      samples[y * stride + x] = v & 0xff;
    }
    prev.fill(samples.slice(y * stride, (y + 1) * stride));
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * bytesPerPixel;
      const d = (y * width + x) * 4;
      let r, g, b, a;
      // Чтение канала: для 16-bit берём старший байт (>>8)
      const readCh = (offset) => bytesPerChannel === 2 ? (samples[offset] << 8 | samples[offset + 1]) >> 8 : samples[offset];
      switch (colorType) {
        case 0: r = g = b = readCh(s); a = 255; break;
        case 2: r = readCh(s); g = readCh(s + bytesPerChannel); b = readCh(s + bytesPerChannel * 2); a = 255; break;
        case 3: {
          const idx = samples[s] * 3;
          r = palette[idx]; g = palette[idx + 1]; b = palette[idx + 2]; a = 255; break;
        }
        case 4: r = g = b = readCh(s); a = readCh(s + bytesPerChannel); break;
        case 6: r = readCh(s); g = readCh(s + bytesPerChannel); b = readCh(s + bytesPerChannel * 2); a = readCh(s + bytesPerChannel * 3); break;
      }
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
    }
  }
  return { width, height, rgba };
}

// Находит bounding box "содержимого":
//  - если изображение непрозрачное (белый/цветной фон) — по отличию от фонового цвета;
//  - если есть прозрачность — по alpha.
function findBoundingBox(rgba, width, height, alphaThreshold) {
  const th = alphaThreshold == null ? 32 : alphaThreshold;

  // Доля прозрачных пикселей
  let transparent = 0, total = width * height;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] < 200) transparent++;
  }
  const isTransparentBg = transparent / total > 0.1;

  // Фоновый цвет: среднее по углам и серединам краёв
  const corners = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
    [Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)]
  ];
  let fr = 0, fg = 0, fb = 0, fn = 0;
  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 200) continue; // прозрачный угол — фон прозрачный
    fr += rgba[i]; fg += rgba[i + 1]; fb += rgba[i + 2]; fn++;
  }
  let bg = null;
  if (fn > 0) {
    bg = { r: fr / fn, g: fg / fn, b: fb / fn };
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      let isContent = false;
      if (isTransparentBg) {
        // Прозрачный фон: содержимое = непрозрачные пиксели
        isContent = a > th;
      } else if (bg) {
        // Непрозрачный фон: содержимое = пиксели, отличающиеся от фона
        const dist = Math.abs(rgba[i] - bg.r) + Math.abs(rgba[i + 1] - bg.g) + Math.abs(rgba[i + 2] - bg.b);
        isContent = dist > 60;
      } else {
        isContent = a > th;
      }
      if (isContent) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

// Вырезает прямоугольник из RGBA
function cropRect(rgba, width, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    rgba.copy(out, y * w * 4, (y0 + y) * width * 4 + x0 * 4, (y0 + y) * width * 4 + (x0 + w) * 4);
  }
  return out;
}

// Добавляет прозрачный отступ вокруг изображения
function padImage(rgba, srcW, srcH, padX, padY) {
  const dstW = srcW + padX * 2;
  const dstH = srcH + padY * 2;
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < srcH; y++) {
    rgba.copy(out, (y + padY) * dstW * 4 + padX * 4, y * srcW * 4, (y + 1) * srcW * 4);
  }
  return { rgba: out, width: dstW, height: dstH };
}

// ======================= PNG-энкодер =======================
function crc32(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
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
function encodePng(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ======================= обработка =======================
// Центральная обрезка до квадрата
function extractCenter(rgba, srcW, srcH) {
  const side = Math.min(srcW, srcH);
  const offX = Math.floor((srcW - side) / 2);
  const offY = Math.floor((srcH - side) / 2);
  return { rgba: cropRect(rgba, srcW, offX, offY, side, side), size: side };
}

// боксовый ресайз (среднее по региону) — качественнее, чем nearest для уменьшения
function boxResize(src, srcSize, dstSize) {
  const out = Buffer.alloc(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    const y0 = Math.floor(y * scale), y1 = Math.min(srcSize, Math.floor((y + 1) * scale) + 1);
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.min(srcSize, Math.floor((x + 1) * scale) + 1);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcSize + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const o = (y * dstSize + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// мягкое скругление углов (разумные скругления, чтобы логотип не выглядел рубленым)
function roundCorners(rgba, size, radius) {
  const out = Buffer.from(rgba);
  const r = radius;
  function inside(x, y) {
    if (x >= r && x < size - r) return true;
    if (y >= r && y < size - r) return true;
    // ближайший угол
    const cx = x < size / 2 ? r : size - 1 - r;
    const cy = y < size / 2 ? r : size - 1 - r;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) {
        const i = (y * size + x) * 4;
        out[i + 3] = 0;
      }
    }
  }
  return out;
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let dataOffset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size === 256 ? 0 : size;
    e[1] = size === 256 ? 0 : size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(dataOffset, 12);
    entries.push(e);
    dataOffset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

// ======================= main =======================
const srcPath = path.join(__dirname, 'icon.png');
if (!fs.existsSync(srcPath)) {
  console.error('❌ Не найден ' + srcPath + ' — положите ваш логотип сюда');
  process.exit(1);
}

const src = decodePng(fs.readFileSync(srcPath));
console.log('📄 Исходник: ' + src.width + 'x' + src.height);

// 1) Авто-кадрирование по непрозрачной области (убираем поля A4-листа)
const box = findBoundingBox(src.rgba, src.width, src.height);
if (!box) {
  console.error('❌ Изображение полностью прозрачно — невозможно сгенерировать иконку');
  process.exit(1);
}
const boxW = box.maxX - box.minX + 1;
const boxH = box.maxY - box.minY + 1;
console.log('✂️  Область логотипа: ' + box.minX + ',' + box.minY + ' .. ' + box.maxX + ',' + box.maxY + ' (' + boxW + 'x' + boxH + ')');

let img = cropRect(src.rgba, src.width, box.minX, box.minY, boxW, boxH);

// 2) Небольшой отступ вокруг логотипа (10% от размера, минимум 8px)
const padPx = Math.max(8, Math.round(Math.max(boxW, boxH) * 0.10));
const padded = padImage(img, boxW, boxH, padPx, padPx);
img = padded.rgba;
const imgW = padded.width;
const imgH = padded.height;
console.log('📦 После паддинга: ' + imgW + 'x' + imgH);

// 3) Центральный квадрат
const square = extractCenter(img, imgW, imgH);
console.log('✂️  Квадрат: ' + square.size + 'x' + square.size);

// 4) Ресайз в 512
let big = boxResize(square.rgba, square.size, 512);

// 5) Скругление (радиус ~8% от размера)
big = roundCorners(big, 512, 42);

const png512 = encodePng(big, 512);
// build/ — для electron-builder (иконка установщика/окна)
fs.writeFileSync(path.join(__dirname, 'build', 'icon.png'), png512);
fs.writeFileSync(path.join(__dirname, 'build', 'logo.png'), png512);
// assets/ — попадает в asar и используется приложением в рантайме
if (!fs.existsSync(path.join(__dirname, 'assets'))) fs.mkdirSync(path.join(__dirname, 'assets'));
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), png512);
fs.writeFileSync(path.join(__dirname, 'assets', 'logo.png'), png512);

// 6) Иконка всех размеров
const sizes = [256, 128, 64, 48, 32, 16];
const images = sizes.map(size => {
  const rgba = size === 512 ? big : boxResize(big, 512, size);
  return { size, png: encodePng(rgba, size) };
});
fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), buildIco(images));

console.log('✅ Готово:');
console.log('   build/icon.png  (' + png512.length + ' b)');
console.log('   build/logo.png  (' + png512.length + ' b)');
console.log('   build/icon.ico  (' + fs.statSync(path.join(__dirname, 'build', 'icon.ico')).size + ' b)');
