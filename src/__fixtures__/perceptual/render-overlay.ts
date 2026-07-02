// Renders traced paths over their faint source image to a PNG buffer — the
// eyeball side of the perceptual harness (Karpathy rule: green tests never
// prove the art looks right; a human looking at pixels does).
// Closed polylines draw red, open ones blue, source ink light grey.
// Pure except for zlib deflate; test-only.

import { deflateSync } from 'node:zlib';
import type { ColoredPath, Vec2 } from '../../core/scene';
import type { RawImageData } from '../../core/trace';

type Rgb = readonly [number, number, number];

const UNDERLAY_GREY: Rgb = [210, 210, 210];
const CLOSED_RED: Rgb = [220, 0, 0];
const OPEN_BLUE: Rgb = [0, 90, 220];
const INK_LUMA_MAX = 128;

/** Render source + traced overlay at an integer scale to PNG bytes. */
export function renderTraceOverlay(
  image: RawImageData,
  paths: ReadonlyArray<ColoredPath>,
  scale: number,
): Uint8Array {
  const W = image.width * scale;
  const H = image.height * scale;
  const rgb = new Uint8Array(W * H * 3).fill(255);
  paintSourceUnderlay(rgb, W, image, scale);
  for (const path of paths)
    for (const pl of path.polylines) {
      const color = pl.closed ? CLOSED_RED : OPEN_BLUE;
      for (let i = 0; i + 1 < pl.points.length; i += 1)
        line(rgb, W, scale, pl.points[i], pl.points[i + 1], color);
      if (pl.closed && pl.points.length > 1)
        line(rgb, W, scale, pl.points[pl.points.length - 1], pl.points[0], color);
    }
  return encodePng(rgb, W, H);
}

function paintSourceUnderlay(rgb: Uint8Array, W: number, image: RawImageData, scale: number): void {
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      const v = image.data[(y * image.width + x) * 4] ?? 255;
      if (v < INK_LUMA_MAX)
        for (let sy = 0; sy < scale; sy += 1)
          for (let sx = 0; sx < scale; sx += 1)
            setPx(rgb, W, x * scale + sx, y * scale + sy, UNDERLAY_GREY);
    }
}

function setPx(rgb: Uint8Array, W: number, x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= W) return;
  const b = (y * W + x) * 3;
  if (b < 0 || b + 2 >= rgb.length) return;
  rgb[b] = c[0];
  rgb[b + 1] = c[1];
  rgb[b + 2] = c[2];
}

function line(
  rgb: Uint8Array,
  W: number,
  scale: number,
  a?: Vec2,
  b?: Vec2,
  c: Rgb = [0, 0, 0],
): void {
  if (!a || !b) return;
  let x0 = Math.round(a.x * scale);
  let y0 = Math.round(a.y * scale);
  const x1 = Math.round(b.x * scale);
  const y1 = Math.round(b.y * scale);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 100000; guard += 1) {
    setPx(rgb, W, x0, y0, c); // setPx bounds-checks via the buffer index
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// ---- minimal PNG encoder (mirrors io png.ts; RGB8, no filter) ----

const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_BIT_DEPTH = 8;
const PNG_COLOR_TYPE_RGB = 2;

function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = PNG_BIT_DEPTH;
  ihdr[9] = PNG_COLOR_TYPE_RGB;
  return concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type);
  const out = new Uint8Array(8 + data.length + 4);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(t, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(concat([t, data])));
  return out;
}

function ascii(s: string): Uint8Array {
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) o[i] = s.charCodeAt(i);
  return o;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const o = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    o.set(p, off);
    off += p.length;
  }
  return o;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
