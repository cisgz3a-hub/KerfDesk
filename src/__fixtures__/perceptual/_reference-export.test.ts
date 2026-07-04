// TEMPORARY reference-comparison exporter (upgrade loop tooling): writes the
// exact PRE-PROCESSED monochrome bitmaps our potrace backend vectorizes as
// 24-bit BMPs, so the official GPL potrace binary (run OUT-OF-PROCESS as a
// measurement reference only — its code never enters this repo) can trace
// the identical input and we can score our vectorization 1:1 against it.
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_reference-export.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { LANGEBAAN_BAND } from './arch-house-edge-truth';
import { inkDisc, paper, toRawImage } from './procedural-ink';
import { decodePngFile } from './png-decode';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts', 'ref');
const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const STAR_TIPS = 12;

it('exports preprocessed fixture bitmaps for the reference tracer', () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  const fixture = requiredArchHouseFixtureStatus();
  if (fixture.path === null) throw new Error('arch-house fixture missing');
  mkdirSync(OUT_DIR, { recursive: true });
  const arch = decodePngFile(fixture.path);
  const items: ReadonlyArray<{ name: string; image: RawImageData }> = [
    { name: 'disc', image: discImage() },
    { name: 'star', image: starImage() },
    { name: 'smalltext', image: downscaleHalf(cropBand(arch)) },
  ];
  for (const item of items) {
    const prepared = preprocessForTrace(item.image, LINE_ART);
    writeFileSync(join(OUT_DIR, `${item.name}.bmp`), encodeBmp24(prepared));
  }
});

function cropBand(image: RawImageData): RawImageData {
  const { x0, y0, x1, y1 } = LANGEBAAN_BAND;
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((y0 + y) * image.width + (x0 + x)) * 4;
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  return { width, height, data };
}

function downscaleHalf(image: RawImageData): RawImageData {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const a = image.data[(y * 2 * image.width + x * 2) * 4 + c] ?? 255;
        const b = image.data[(y * 2 * image.width + x * 2 + 1) * 4 + c] ?? 255;
        const d = image.data[((y * 2 + 1) * image.width + x * 2) * 4 + c] ?? 255;
        const e = image.data[((y * 2 + 1) * image.width + x * 2 + 1) * 4 + c] ?? 255;
        data[(y * width + x) * 4 + c] = (a + b + d + e) / 4;
      }
    }
  }
  return { width, height, data };
}

function discImage(): RawImageData {
  const luma = paper(180, 180);
  inkDisc(luma, 90, 90, 60, 2);
  return toRawImage(luma);
}

function starImage(): RawImageData {
  const size = 200;
  const corners: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < STAR_TIPS * 2; k += 1) {
    const angle = (k / (STAR_TIPS * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? 80 : 45;
    corners.push({ x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) });
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = pointInPolygon(x + 0.5, y + 0.5, corners) ? 0 : 255;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function pointInPolygon(
  px: number,
  py: number,
  polygon: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects = a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Minimal 24-bit uncompressed BMP encoder (bottom-up rows, 4-byte padding).
function encodeBmp24(image: RawImageData): Uint8Array {
  const rowBytes = Math.ceil((image.width * 3) / 4) * 4;
  const pixelBytes = rowBytes * image.height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < image.height; y += 1) {
    const srcRow = image.height - 1 - y;
    for (let x = 0; x < image.width; x += 1) {
      const src = (srcRow * image.width + x) * 4;
      const dst = 54 + y * rowBytes + x * 3;
      out[dst] = image.data[src + 2] ?? 255;
      out[dst + 1] = image.data[src + 1] ?? 255;
      out[dst + 2] = image.data[src] ?? 255;
    }
  }
  return out;
}
