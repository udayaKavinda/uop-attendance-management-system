/**
 * Renders public/apple-touch-icon.png from the same geometry as public/icon.svg.
 *
 * iOS ignores SVG for home-screen icons — "Add to Home Screen" needs a real PNG
 * or it screenshots the page instead — but a binary blob nobody can regenerate
 * is worse than one script. Everything here is plain math plus Node's zlib, so
 * there is no image dependency to install and the icon can be re-rendered after
 * any tweak to the artwork below:
 *
 *   node scripts/generate-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 180;
const SAMPLES = 4; // per axis, so 16 samples/pixel of anti-aliasing
const MAROON = [0x7a, 0x14, 0x14];
const CREAM = [0xf6, 0xf1, 0xea];

// ── Geometry helpers ─────────────────────────────────────────────────────────

const insideRoundedRect = (x, y, w, h, r) => {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  if (x >= r && x <= w - r) return y >= 0 && y <= h;
  if (y >= r && y <= h - r) return x >= 0 && x <= w;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Standard even-odd point-in-polygon. */
const insidePolygon = (x, y, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const distanceToSegment = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};

/** Round-capped, round-joined stroke: within half a stroke width of any segment. */
const onPolyline = (x, y, pts, width) => {
  const half = width / 2;
  for (let i = 1; i < pts.length; i += 1) {
    if (distanceToSegment(x, y, pts[i - 1], pts[i]) <= half) return true;
  }
  return false;
};

const cubic = (p0, p1, p2, p3, steps) => {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
};

// ── The artwork, mirroring icon.svg ──────────────────────────────────────────

const CAP = [[90, 46], [142, 70], [90, 94], [38, 70]];

// The mortarboard's hanging band: down the left, around the bottom, back up.
const BAND = [
  [60, 82],
  ...cubic([60, 108], [60, 108], [72, 120], [90, 120], 24),
  ...cubic([90, 120], [108, 120], [120, 108], [120, 108], 24),
  [120, 82],
];

const TASSEL = [[138, 74], [138, 106]];

/** Returns the colour at a sub-pixel sample, or null where the icon is transparent. */
const sampleAt = (x, y) => {
  if (!insideRoundedRect(x, y, SIZE, SIZE, 40)) return null;
  if (insidePolygon(x, y, CAP)) return CREAM;
  if (onPolyline(x, y, BAND, 10)) return CREAM;
  if (onPolyline(x, y, TASSEL, 7)) return CREAM;
  return MAROON;
};

// ── Rasterise ────────────────────────────────────────────────────────────────

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let cursor = 0;
for (let py = 0; py < SIZE; py += 1) {
  raw[cursor] = 0; // PNG filter type 0 (None) for this scanline
  cursor += 1;
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const colour = sampleAt(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES);
        if (colour) {
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }
    }
    const total = SAMPLES * SAMPLES;
    const covered = a / 255;
    // Average only over covered samples so edge pixels keep the fill colour and
    // vary in alpha, instead of darkening towards black.
    raw[cursor] = covered ? Math.round(r / covered) : 0;
    raw[cursor + 1] = covered ? Math.round(g / covered) : 0;
    raw[cursor + 2] = covered ? Math.round(b / covered) : 0;
    raw[cursor + 3] = Math.round(a / total);
    cursor += 4;
  }
}

// ── PNG container ────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// bytes 10-12: deflate compression, adaptive filtering, no interlace — all 0.

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'apple-touch-icon.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
