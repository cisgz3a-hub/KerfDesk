// THROWAWAY visual-audit harness (delete before commit). Renders each trace
// preset over representative procedural source images to viewable PNGs so a
// human can SEE current output. Not part of the suite's intent — run
// explicitly. Gated on TRACE_AUDIT=1 so a stray `pnpm test` is a no-op.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { traceImageToColoredPaths } from '../../core/trace';
import { TRACE_PRESETS, type RawImageData, type TraceOptions } from '../../core/trace/trace-image';
import type { ColoredPath, Vec2 } from '../../core/scene';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const SCALE = 3;
const PRESETS = ['Line Art', 'Smooth', 'Sharp', 'Centerline', 'Edge Detection'] as const;

// ---- procedural source images (luma buffer: 0 = ink, 255 = paper) ----

type Luma = { readonly w: number; readonly h: number; readonly px: Float32Array };

function paper(w: number, h: number): Luma {
  return { w, h, px: new Float32Array(w * h).fill(255) };
}
function inkDisc(l: Luma, cx: number, cy: number, r: number, soft = 0): void {
  for (let y = 0; y < l.h; y += 1)
    for (let x = 0; x < l.w; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (soft <= 0) {
        if (d <= r) l.px[y * l.w + x] = 0;
      } else {
        const t = Math.max(0, Math.min(1, (r - d) / soft + 0.5));
        l.px[y * l.w + x] = Math.min(l.px[y * l.w + x] ?? 255, 255 * (1 - t));
      }
    }
}
function inkRect(l: Luma, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y < Math.min(l.h, y1); y += 1)
    for (let x = Math.max(0, x0); x < Math.min(l.w, x1); x += 1) l.px[y * l.w + x] = 0;
}
function inkStroke(l: Luma, a: Vec2, b: Vec2, radius: number): void {
  // capsule between a and b
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
  const maxX = Math.min(l.w, Math.ceil(Math.max(a.x, b.x) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
  const maxY = Math.min(l.h, Math.ceil(Math.max(a.y, b.y) + radius + 1));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y < maxY; y += 1)
    for (let x = minX; x < maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= radius) l.px[y * l.w + x] = 0;
    }
}
function toRawImage(l: Luma): RawImageData {
  const data = new Uint8ClampedArray(l.w * l.h * 4);
  for (let i = 0; i < l.w * l.h; i += 1) {
    const v = l.px[i] ?? 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: l.w, height: l.h, data };
}

function fixtures(): Array<{ name: string; image: RawImageData }> {
  // 1. thin pen strokes: an arc + a straight + a cross junction (3px wide)
  const pen = paper(180, 180);
  for (let a = -80; a <= 80; a += 4)
    inkStroke(pen, arc(40, 90, 30, a - 4), arc(40, 90, 30, a), 1.6); // arc
  inkStroke(pen, { x: 90, y: 30 }, { x: 150, y: 150 }, 1.6); // diagonal
  inkStroke(pen, { x: 80, y: 90 }, { x: 150, y: 90 }, 1.6); // horizontal (crosses diagonal)

  // 2. thick fork: a Y with variable width (centerline stress)
  const fork = paper(180, 180);
  inkStroke(fork, { x: 90, y: 170 }, { x: 90, y: 90 }, 9);
  inkStroke(fork, { x: 90, y: 90 }, { x: 45, y: 20 }, 7);
  inkStroke(fork, { x: 90, y: 90 }, { x: 140, y: 25 }, 6);

  // 3. hard-cornered ring with a notch (sharp corners + hole)
  const hard = paper(180, 180);
  inkRect(hard, 30, 30, 150, 150);
  inkRect(hard, 62, 62, 118, 118); // hole (re-paper)
  for (let y = 62; y < 118; y += 1) for (let x = 62; x < 118; x += 1) hard.px[y * 180 + x] = 255;
  inkRect(hard, 84, 10, 96, 40); // notch spike on top

  // 4. soft disc with anti-aliased edge + a lighter inner blob (edge/border + threshold)
  const soft = paper(180, 180);
  inkDisc(soft, 90, 90, 60, 6);
  inkDisc(soft, 110, 75, 22, 10);

  return [
    { name: '1-pen-strokes', image: toRawImage(pen) },
    { name: '2-thick-fork', image: toRawImage(fork) },
    { name: '3-hard-ring-notch', image: toRawImage(hard) },
    { name: '4-soft-disc', image: toRawImage(soft) },
  ];
}
function arc(cx: number, cy: number, r: number, deg: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a) * 1.6 + 40, y: cy + r * Math.sin(a) };
}

// ---- overlay render + PNG ----

function render(image: RawImageData, paths: ReadonlyArray<ColoredPath>): Uint8Array {
  const W = image.width * SCALE;
  const H = image.height * SCALE;
  const rgb = new Uint8Array(W * H * 3).fill(255);
  paintSourceUnderlay(rgb, W, image);
  // trace lines: closed=red, open=blue
  for (const path of paths)
    for (const pl of path.polylines) {
      const color: Rgb = pl.closed ? [220, 0, 0] : [0, 90, 220];
      for (let i = 0; i + 1 < pl.points.length; i += 1)
        line(rgb, W, pl.points[i], pl.points[i + 1], color);
      if (pl.closed && pl.points.length > 1)
        line(rgb, W, pl.points[pl.points.length - 1], pl.points[0], color);
    }
  return encodePng(rgb, W, H);
}

function paintSourceUnderlay(rgb: Uint8Array, W: number, image: RawImageData): void {
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1) {
      const v = image.data[(y * image.width + x) * 4] ?? 255;
      if (v < 128)
        for (let sy = 0; sy < SCALE; sy += 1)
          for (let sx = 0; sx < SCALE; sx += 1)
            setPx(rgb, W, x * SCALE + sx, y * SCALE + sy, [210, 210, 210]);
    }
}
type Rgb = readonly [number, number, number];
function setPx(rgb: Uint8Array, W: number, x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= W) return;
  const b = (y * W + x) * 3;
  if (b < 0 || b + 2 >= rgb.length) return;
  rgb[b] = c[0];
  rgb[b + 1] = c[1];
  rgb[b + 2] = c[2];
}
function line(rgb: Uint8Array, W: number, a?: Vec2, b?: Vec2, c: Rgb = [0, 0, 0]): void {
  if (!a || !b) return;
  let x0 = Math.round(a.x * SCALE);
  let y0 = Math.round(a.y * SCALE);
  const x1 = Math.round(b.x * SCALE);
  const y1 = Math.round(b.y * SCALE);
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

// minimal PNG (mirrors png.ts)
const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
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

it('renders trace presets for visual audit', async () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  mkdirSync(OUT_DIR, { recursive: true });
  for (const fx of fixtures())
    for (const presetName of PRESETS) {
      const options = TRACE_PRESETS[presetName] as TraceOptions;
      const paths = await traceImageToColoredPaths(fx.image, options);
      const png = render(fx.image, paths);
      const slug = presetName.toLowerCase().replace(/\s+/g, '-');
      writeFileSync(join(OUT_DIR, `${fx.name}__${slug}.png`), png);
    }
}, 60000);
