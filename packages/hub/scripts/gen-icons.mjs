// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

//
// Generates placeholder PWA icons (PNG) so the app is installable, using only
// Node built-ins (zlib) — no image dependencies. The mark mirrors the
// placeholder brand logo (Sea to Sky peaks over a road). Replace with the final
// brand asset when available; re-run with `pnpm --filter @nissegroup/hub gen:icons`.
//

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
mkdirSync(publicDir, { recursive: true });

// Colours (Spakwus mark: pine square, cream peaks + road, pine dashes).
const BG = [46, 74, 56, 255]; // #2e4a38 pine
const PEAK = [243, 239, 229, 255]; // #f3efe5 cream
const ROAD = [243, 239, 229, 255]; // #f3efe5 cream
const DASH = [46, 74, 56, 255]; // pine dashes on the road
const CLEAR = [0, 0, 0, 0];

// Reference geometry in a 512 grid.
const PEAKS = [
  [96, 340],
  [200, 190],
  [268, 286],
  [330, 150],
  [416, 340],
];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pixel(x, y, size) {
  const s = size / 512;
  const u = x / s;
  const v = y / s;

  // Rounded corners (radius ~96/512).
  const r = 96;
  const inX = Math.min(u, 512 - u);
  const inY = Math.min(v, 512 - v);
  if (inX < r && inY < r) {
    const dx = r - inX;
    const dy = r - inY;
    if (dx * dx + dy * dy > r * r) return CLEAR;
  }

  // Road band with dashes.
  if (v >= 352 && v <= 380 && u >= 96 && u <= 416) {
    const dashStarts = [150, 236, 322];
    for (const ds of dashStarts) {
      if (v >= 360 && v <= 372 && u >= ds && u <= ds + 40) return DASH;
    }
    return ROAD;
  }

  // Mountain peaks.
  if (pointInPolygon(u, v, PEAKS)) return PEAK;

  return BG;
}

// --- Minimal PNG (RGBA) encoder -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y, size);
      raw[o++] = p[0];
      raw[o++] = p[1];
      raw[o++] = p[2];
      raw[o++] = p[3];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ["pwa-192x192.png", 192],
  ["pwa-512x512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(new URL(name, `file://${publicDir}`), encodePng(size));
  console.log(`wrote public/${name} (${size}x${size})`);
}
