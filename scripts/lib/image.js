'use strict';

/**
 * Работа с изображениями для генераторов иконок — без внешних зависимостей.
 *
 * Умеет: декодировать PNG (8/16 бит, color types 0/2/3/4/6), кодировать PNG,
 * масштабировать, обрезать, скруглять углы и собирать Windows .ico
 * (крупный кадр — PNG, мелкие — DIB/BMP, как ожидает Проводник).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- PNG: декодирование ------------------------------------------------------

function decodePng(buf) {
  if (buf.length < 33 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Файл не является PNG');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`Поддерживается только глубина 8 или 16 бит, получено: ${bitDepth}`);
  }

  let offset = 8;
  const idat = [];
  let palette = null;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    offset += 12 + length;
  }
  if (idat.length === 0) throw new Error('В PNG нет данных изображения');

  const raw = zlib.inflateSync(Buffer.concat(idat));

  let channels;
  switch (colorType) {
    case 0:
      channels = 1;
      break;
    case 2:
      channels = 3;
      break;
    case 3:
      channels = 1;
      break;
    case 4:
      channels = 2;
      break;
    case 6:
      channels = 4;
      break;
    default:
      throw new Error(`Неподдерживаемый color type: ${colorType}`);
  }

  const bytesPerChannel = bitDepth === 16 ? 2 : 1;
  const bytesPerPixel = channels * bytesPerChannel;
  const stride = width * bytesPerPixel;
  const samples = Buffer.alloc(height * stride);
  const previousRow = Buffer.alloc(stride);
  let position = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const row = raw.subarray(position, position + stride);
    position += stride;
    for (let x = 0; x < stride; x++) {
      let value = row[x];
      const left = x >= bytesPerPixel ? samples[y * stride + x - bytesPerPixel] : 0;
      const up = previousRow[x];
      const upLeft = x >= bytesPerPixel && y > 0 ? previousRow[x - bytesPerPixel] : 0;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      samples[y * stride + x] = value & 0xff;
    }
    previousRow.fill(samples.subarray(y * stride, (y + 1) * stride));
  }

  const rgba = Buffer.alloc(width * height * 4);
  const readChannel = (index) =>
    bytesPerChannel === 2 ? ((samples[index] << 8) | samples[index + 1]) >> 8 : samples[index];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = y * stride + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      let r;
      let g;
      let b;
      let a;
      switch (colorType) {
        case 0:
          r = g = b = readChannel(source);
          a = 255;
          break;
        case 2:
          r = readChannel(source);
          g = readChannel(source + bytesPerChannel);
          b = readChannel(source + bytesPerChannel * 2);
          a = 255;
          break;
        case 3: {
          if (!palette) throw new Error('В PNG нет палитры');
          const index = samples[source] * 3;
          r = palette[index];
          g = palette[index + 1];
          b = palette[index + 2];
          a = 255;
          break;
        }
        case 4:
          r = g = b = readChannel(source);
          a = readChannel(source + bytesPerChannel);
          break;
        default:
          r = readChannel(source);
          g = readChannel(source + bytesPerChannel);
          b = readChannel(source + bytesPerChannel * 2);
          a = readChannel(source + bytesPerChannel * 3);
          break;
      }
      rgba[target] = r;
      rgba[target + 1] = g;
      rgba[target + 2] = b;
      rgba[target + 3] = a;
    }
  }

  return { width, height, rgba };
}

// --- PNG: кодирование --------------------------------------------------------

function crc32(buffer) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buffer.length; n++) {
    c = (crc ^ buffer[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Геометрия ---------------------------------------------------------------

function cropRect(rgba, width, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    rgba.copy(out, y * w * 4, (y0 + y) * width * 4 + x0 * 4, (y0 + y) * width * 4 + (x0 + w) * 4);
  }
  return out;
}

function padImage(rgba, srcW, srcH, padX, padY) {
  const dstW = srcW + padX * 2;
  const dstH = srcH + padY * 2;
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < srcH; y++) {
    rgba.copy(out, (y + padY) * dstW * 4 + padX * 4, y * srcW * 4, (y + 1) * srcW * 4);
  }
  return { rgba: out, width: dstW, height: dstH };
}

function extractCenter(rgba, srcW, srcH) {
  const side = Math.min(srcW, srcH);
  const offX = Math.floor((srcW - side) / 2);
  const offY = Math.floor((srcH - side) / 2);
  return { rgba: cropRect(rgba, srcW, offX, offY, side, side), size: side };
}

function boxResize(src, srcSize, dstSize) {
  const out = Buffer.alloc(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(srcSize, Math.floor((y + 1) * scale) + 1);
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(srcSize, Math.floor((x + 1) * scale) + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcSize + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          count++;
        }
      }
      const o = (y * dstSize + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round(a / count);
    }
  }
  return out;
}

function roundCorners(rgba, size, radius) {
  const out = Buffer.from(rgba);
  const r = radius;
  const inside = (x, y) => {
    if (x >= r && x < size - r) return true;
    if (y >= r && y < size - r) return true;
    const cx = x < size / 2 ? r : size - 1 - r;
    const cy = y < size / 2 ? r : size - 1 - r;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) out[(y * size + x) * 4 + 3] = 0;
    }
  }
  return out;
}

/**
 * Кадр ICO в формате DIB (BITMAPINFOHEADER + BGRA + AND-маска).
 * Именно такой формат Windows ожидает для размеров меньше 256×256.
 */
function encodeDib(rgba, size) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskSize = maskRowBytes * size;
  const buffer = Buffer.alloc(headerSize + xorSize + maskSize);

  buffer.writeUInt32LE(headerSize, 0);
  buffer.writeInt32LE(size, 4);
  buffer.writeInt32LE(size * 2, 8);
  buffer.writeUInt16LE(1, 12);
  buffer.writeUInt16LE(32, 14);
  buffer.writeUInt32LE(0, 16);
  buffer.writeUInt32LE(xorSize, 20);

  let offset = headerSize;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      buffer[offset++] = rgba[i + 2];
      buffer[offset++] = rgba[i + 1];
      buffer[offset++] = rgba[i];
      buffer[offset++] = rgba[i + 3];
    }
  }
  // AND-маска: прозрачность уже в альфа-канале, поэтому маска нулевая.
  buffer.fill(0, headerSize + xorSize);
  return buffer;
}

/**
 * @param {{size:number, format:'png'|'dib', data:Buffer}[]} images
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let dataOffset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    entries.push(entry);
    dataOffset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const ICO_SIZES = [256, 128, 64, 48, 32, 16];

function buildIcoFromSquare(rgba512) {
  const images = ICO_SIZES.map((size) => {
    const square = size === 512 ? rgba512 : boxResize(rgba512, 512, size);
    return size >= 256
      ? { size, format: 'png', data: encodePng(square, size, size) }
      : { size, format: 'dib', data: encodeDib(square, size) };
  });
  return buildIco(images);
}

/**
 * Записывает готовый набор: build/icon.png, build/logo.png, build/icon.ico,
 * assets/icon.png, assets/logo.png. Папки создаются при необходимости.
 */
function writeIconSet(rgba512, options) {
  const { buildDir, assetsDir } = options;
  const png = encodePng(rgba512, 512, 512);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const files = {
    iconPng: path.join(buildDir, 'icon.png'),
    logoPng: path.join(buildDir, 'logo.png'),
    iconIco: path.join(buildDir, 'icon.ico'),
    assetIcon: path.join(assetsDir, 'icon.png'),
    assetLogo: path.join(assetsDir, 'logo.png')
  };

  fs.writeFileSync(files.iconPng, png);
  fs.writeFileSync(files.logoPng, png);
  fs.writeFileSync(files.assetIcon, png);
  fs.writeFileSync(files.assetLogo, png);
  fs.writeFileSync(files.iconIco, buildIcoFromSquare(rgba512));

  return { files, pngSize: png.length, icoSize: fs.statSync(files.iconIco).size };
}

module.exports = {
  decodePng,
  encodePng,
  cropRect,
  padImage,
  extractCenter,
  boxResize,
  roundCorners,
  encodeDib,
  buildIco,
  buildIcoFromSquare,
  writeIconSet,
  ICO_SIZES
};
