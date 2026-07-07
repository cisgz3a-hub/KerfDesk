// Reproduce the user's faceted E/B (2026-07-04): the arch logo (1024px, ~110px
// letters) traces smooth, but standalone letters from a SMALL import facet. This
// renders "E" and "B" at small pixel heights WITH anti-aliasing (supersample +
// box-downscale, emulating a real small raster) and traces them via the app's
// MERGED Edge options — the faithful reproduction of what the user sees.
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_small-letter-facet.test.ts

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { textToPolylines } from '../../core/text/text-to-polylines';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const FACET_TURN_RAD = (14 * Math.PI) / 180;
const CORNER_TURN_RAD = (55 * Math.PI) / 180;
const AA_SUPERSAMPLE = 3;
const PAD_PX = 10;

// App default merged Edge options (see _edge-rough-smoothness.test.ts).
function mergedEdgeOptions(): TraceOptions {
  return {
    ...(TRACE_PRESETS['Edge Detection'] as TraceOptions),
    edgeLowThresholdRatio: 0.074,
    edgeHighThresholdRatio: 0.185,
    edgeMinLengthPx: 3,
  };
}

function readFontBuffer(fileName: string): ArrayBuffer {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';

it.skipIf(!RUN_TRACE_AUDIT)(
  'measures small anti-aliased E/B faceting via merged app options',
  { timeout: 120000 },
  async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const font = readFontBuffer('Roboto-Regular.ttf');
    const options = mergedEdgeOptions();
    const lines: string[] = ['--- small anti-aliased letters, merged app Edge options ---'];
    for (const glyph of ['E', 'B', 'S', 'O']) {
      for (const heightPx of [40, 60, 90]) {
        const image = await rasterizeAaGlyph(font, glyph, heightPx);
        const traced = (await traceImageToColoredPaths(image, options)).flatMap((p) => p.polylines);
        lines.push(`${glyph}@${heightPx}px: ${facetReport(traced)}`);
        writeFileSync(
          join(OUT_DIR, `small__${glyph}_${heightPx}.png`),
          renderTraceOverlay(image, [{ color: '#000000', polylines: traced }], 5),
        );
      }
    }
    writeFileSync(join(OUT_DIR, 'small__metrics.txt'), `${lines.join('\n')}\n`);
  },
);

// Render a glyph, supersampled then box-downscaled for realistic anti-aliasing.
async function rasterizeAaGlyph(
  font: ArrayBuffer,
  glyph: string,
  heightPx: number,
): Promise<RawImageData> {
  const s = AA_SUPERSAMPLE;
  const result = await textToPolylines({
    fontBuffer: font,
    content: glyph,
    sizeMm: heightPx * 1.4 * s,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#000000',
  });
  const outline = result.paths.flatMap((p) => p.polylines);
  const bounds = boundsOf(outline);
  const scale = (heightPx * s) / (bounds.maxY - bounds.minY);
  const pad = PAD_PX * s;
  const toPx = (p: Vec2): Vec2 => ({
    x: (p.x - bounds.minX) * scale + pad,
    y: (p.y - bounds.minY) * scale + pad,
  });
  const ref = outline.map((pl) => ({ closed: pl.closed, points: pl.points.map(toPx) }));
  const bigW = Math.ceil((bounds.maxX - bounds.minX) * scale) + pad * 2;
  const bigH = Math.ceil((bounds.maxY - bounds.minY) * scale) + pad * 2;
  return boxDownscale(fillOutline(ref, bigW, bigH), s);
}

function facetReport(polylines: ReadonlyArray<Polyline>): string {
  let steps = 0;
  let facets = 0;
  for (const pl of polylines) {
    const s = densify(pl, 1);
    for (let i = 1; i + 1 < s.length; i += 1) {
      const turn = Math.abs(turnAt(s[i - 1] as Vec2, s[i] as Vec2, s[i + 1] as Vec2));
      if (turn > CORNER_TURN_RAD) continue;
      steps += 1;
      if (turn >= FACET_TURN_RAD) facets += 1;
    }
  }
  const ratio = steps === 0 ? 0 : (facets / steps) * 100;
  const points = polylines.reduce((sum, pl) => sum + pl.points.length, 0);
  return `polylines=${polylines.length} points=${points} facetRatio=${ratio.toFixed(2)}%`;
}

function densify(polyline: Polyline, step: number): Vec2[] {
  const pts =
    polyline.closed && polyline.points[0] !== undefined
      ? [...polyline.points, polyline.points[0]]
      : [...polyline.points];
  const out: Vec2[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-9) continue;
    let t = carry;
    while (t < seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += step;
    }
    carry = t - seg;
  }
  return out;
}

function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const a1 = Math.atan2(at.y - prev.y, at.x - prev.x);
  const a2 = Math.atan2(next.y - at.y, next.x - at.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function boundsOf(polylines: ReadonlyArray<Polyline>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pl of polylines) {
    for (const p of pl.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function fillOutline(ref: ReadonlyArray<Polyline>, width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = false;
      const px = x + 0.5;
      const py = y + 0.5;
      for (const pl of ref) {
        const pts = pl.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
          const a = pts[i];
          const b = pts[j];
          if (a === undefined || b === undefined) continue;
          if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
          }
        }
      }
      if (inside) {
        const o = (y * width + x) * 4;
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
      }
    }
  }
  return { width, height, data };
}

function boxDownscale(image: RawImageData, factor: number): RawImageData {
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy += 1) {
          for (let dx = 0; dx < factor; dx += 1) {
            sum += image.data[((y * factor + dy) * image.width + (x * factor + dx)) * 4 + c] ?? 255;
          }
        }
        data[(y * width + x) * 4 + c] = sum / (factor * factor);
      }
    }
  }
  return { width, height, data };
}
