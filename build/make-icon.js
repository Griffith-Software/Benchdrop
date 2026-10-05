// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Griffith.Software — https://griffith.software
// Benchdrop app icon.
//
// Mark: an arrow dropping onto a workbench - the same glyph shown above
// "Drag a project here" in the app. Warm wood plate, brass arrow.
//
// Writes, from one drawing:
//   build/icon-master-1024.png  1024x1024 master: square, opaque, no rounded
//                               corners (what stores and the website start from)
//   build/icon.png              1024x1024 app icon with the rounded plate
//   build/icon.ico              16, 24, 32, 48, 64, 128, 256 px, from the app icon
//
// Regenerate with:  npm run build:icon   (runs this under Electron's own Chromium)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Runs in the page. Draws at 4x and scales down in halves for clean edges.
function draw(opts) {
  const S = 1024, SS = 4, N = S * SS, u = SS, s = 2; // 512 design grid -> 1024
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const d = c.getContext('2d');
  const rr = (x0, y0, x1, y1, r, fill) => { d.fillStyle = fill; d.beginPath(); d.roundRect(x0, y0, x1 - x0, y1 - y0, r); d.fill(); };
  const WOOD_DARK = '#17100B', WOOD = '#2C1E14', GRAIN = '#342418';
  const AMBER = '#D99A4E', AMBER_LIT = '#F0B96B', AMBER_DIM = '#9A6C37';

  if (opts.square) {
    // Master: the inner plate runs to the edges, so the mark sits the same way
    // and a platform can apply its own corner shape.
    d.fillStyle = WOOD; d.fillRect(0, 0, N, N);
  } else {
    rr(0, 0, N, N, 220 * u, WOOD_DARK);
    rr(38 * u, 38 * u, (S - 38) * u, (S - 38) * u, 186 * u, WOOD);
  }
  // subtle grain on the plate
  d.fillStyle = GRAIN;
  const y0 = opts.square ? 0 : 44 * s * u, y1 = opts.square ? N : 468 * s * u;
  for (let x = 60; x < 460; x += 9) d.fillRect(x * s * u - u / 4, y0, u / 2, y1 - y0);

  const cx = 256 * s * u, shaftW = 30 * s * u;
  rr(cx - shaftW / 2, 118 * s * u, cx + shaftW / 2, 268 * s * u, shaftW / 2, AMBER);   // arrow shaft
  d.fillStyle = AMBER; d.beginPath();                                                  // arrow head
  d.moveTo(184 * s * u, 240 * s * u); d.lineTo(328 * s * u, 240 * s * u); d.lineTo(256 * s * u, 330 * s * u);
  d.closePath(); d.fill();
  const top = 352 * s * u;                                                             // bench top and legs
  rr(92 * s * u, top, 420 * s * u, top + 30 * s * u, 15 * s * u, AMBER_LIT);
  for (const lx of [132 * s * u, 352 * s * u]) rr(lx, top + 30 * s * u, lx + 28 * s * u, 432 * s * u, 13 * s * u, AMBER_DIM);

  const scaled = (src, size) => {
    let cur = src;
    while (cur.width / 2 >= size) {
      const h = document.createElement('canvas'); h.width = h.height = cur.width / 2;
      const hc = h.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, 0, 0, h.width, h.height); cur = h;
    }
    if (cur.width !== size) {
      const f = document.createElement('canvas'); f.width = f.height = size;
      const fc = f.getContext('2d'); fc.imageSmoothingQuality = 'high'; fc.drawImage(cur, 0, 0, size, size); cur = f;
    }
    return cur;
  };
  const out = {};
  for (const size of opts.sizes) {
    const k = scaled(c, size);
    out[size] = { png: k.toDataURL('image/png'), rgba: Array.from(k.getContext('2d').getImageData(0, 0, size, size).data) };
  }
  return out;
}

// A classic ICO: 32-bit BMP frames below 256 px, PNG for 256 (what Windows expects).
function writeIco(file, frames) {
  const images = ICO_SIZES.map((size) => {
    const f = frames[size];
    if (size === 256) return Buffer.from(f.png.split(',')[1], 'base64');
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, o = ((size - 1 - y) * size + x) * 4; // bottom-up, BGRA
      pixels[o] = f.rgba[i + 2]; pixels[o + 1] = f.rgba[i + 1]; pixels[o + 2] = f.rgba[i]; pixels[o + 3] = f.rgba[i + 3];
    }
    const maskRow = Math.ceil(size / 32) * 4;
    return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]); // alpha carries transparency
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, n) => {
    const size = ICO_SIZES[n], e = 6 + 16 * n;
    dir.writeUInt8(size === 256 ? 0 : size, e); dir.writeUInt8(size === 256 ? 0 : size, e + 1);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  fs.writeFileSync(file, Buffer.concat([dir, ...images]));
}

// The master as an RGB PNG: no alpha channel at all (stores reject one).
function rgbPng(size, rgba) {
  const zlib = require('zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, o = y * (size * 3 + 1) + 1 + x * 3;
    raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const run = (opts) => win.webContents.executeJavaScript(`(${draw.toString()})(${JSON.stringify(opts)})`);
  const png = (f) => Buffer.from(f.png.split(',')[1], 'base64');

  const master = await run({ square: true, sizes: [1024] });
  fs.writeFileSync(path.join(__dirname, 'icon-master-1024.png'), rgbPng(1024, master[1024].rgba));
  const rounded = await run({ square: false, sizes: [1024, ...ICO_SIZES] });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), png(rounded[1024]));
  writeIco(path.join(__dirname, 'icon.ico'), rounded);
  console.log('wrote icon-master-1024.png, icon.png (1024) and icon.ico (' + ICO_SIZES.join(', ') + ')');
  app.quit();
});
