// Curve-smoothness audit for Edge Detection on a real letter (reported
// 2026-07-04: the "B" bowls trace as faceted polygonal chords instead of
// smooth arcs). VERIFIED REFERENCE = the actual Roboto "B" glyph outline
// (opentype), rasterized then traced, so we measure the traced curve's
// deviation + faceting against the true font curve at several sizes. Also
// exports the rasterized bitmap so the official potrace binary can vectorize
// the identical input as a second reference.
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_letter-b-smoothness.test.ts

import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { textToPolylines } from '../../core/text/text-to-polylines';
import { sampleByArcLength } from './centerline-geometry';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const REF_DIR = join(OUT_DIR, 'ref');
const EDGE = TRACE_PRESETS['Edge Detection'] as TraceOptions;
const PAD_PX = 12;
// A curve span turning MORE than this per 1px step is a facet kink; a smooth
// arc of radius r turns ~ (1/r) rad/px, well under this for letter bowls.
const FACET_TURN_RAD = (14 * Math.PI) / 180;

function readFontBuffer(fileName: string): ArrayBuffer {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

it('measures B-bowl smoothness against the real glyph outline', { timeout: 120000 }, async () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  mkdirSync(REF_DIR, { recursive: true });
  const fontBuffer = readFontBuffer('Roboto-Regular.ttf');
  const lines: string[] = [];
  for (const heightPx of [60, 100, 160]) {
    const { image, reference } = await rasterizeGlyph(fontBuffer, 'B', heightPx);
    const traced = traceImageToEdgePaths(image, EDGE).flatMap((p) => p.polylines);
    lines.push(describe(heightPx, traced, reference));
    writeFileSync(
      join(OUT_DIR, `letterB__h${heightPx}__edge.png`),
      renderTraceOverlay(image, [{ color: '#000000', polylines: traced }], 4),
    );
    writeFileSync(join(REF_DIR, `letterB-h${heightPx}.bmp`), encodeBmp24(image));
    if (heightPx === 100) writeFileSync(join(REF_DIR, 'letterB.bmp'), encodeBmp24(image));
  }
  writeFileSync(join(OUT_DIR, 'letterB__metrics.txt'), `${lines.join('\n')}\n`);
});

// Render a glyph outline to a filled bitmap + return the reference outline in
// image pixel coordinates (densely sampled — the true smooth curve).
async function rasterizeGlyph(
  fontBuffer: ArrayBuffer,
  glyph: string,
  heightPx: number,
): Promise<{ image: RawImageData; reference: Polyline[] }> {
  // opentype size is in the same unit as its output; render big, then map to
  // pixels by the glyph's own bounds.
  const sizeMm = heightPx * 1.4;
  const result = await textToPolylines({
    fontBuffer,
    content: glyph,
    sizeMm,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#000000',
  });
  const outline = result.paths.flatMap((path) => path.polylines);
  const bounds = boundsOf(outline);
  const scale = heightPx / (bounds.maxY - bounds.minY);
  const toPx = (p: Vec2): Vec2 => ({
    x: (p.x - bounds.minX) * scale + PAD_PX,
    y: (p.y - bounds.minY) * scale + PAD_PX,
  });
  const reference = outline.map((pl) => ({ closed: pl.closed, points: pl.points.map(toPx) }));
  const width = Math.ceil((bounds.maxX - bounds.minX) * scale) + PAD_PX * 2;
  const height = Math.ceil((bounds.maxY - bounds.minY) * scale) + PAD_PX * 2;
  return { image: fillOutline(reference, width, height), reference };
}

function describe(heightPx: number, traced: Polyline[], reference: Polyline[]): string {
  const refSamples = reference.flatMap((pl) => densify(pl, 0.5));
  const tracedSamples = traced.flatMap((pl) => densify(pl, 1));
  let maxDev = 0;
  let sumDev = 0;
  for (const p of tracedSamples) {
    const d = nearest(p, refSamples);
    maxDev = Math.max(maxDev, d);
    sumDev += d;
  }
  const meanDev = tracedSamples.length === 0 ? 0 : sumDev / tracedSamples.length;
  // Faceting: fraction of 1px steps along traced curves that kink past the
  // facet threshold, excluding genuine corners (turn > 55°).
  let steps = 0;
  let facets = 0;
  for (const pl of traced) {
    const s = densify(pl, 1);
    for (let i = 1; i + 1 < s.length; i += 1) {
      const turn = Math.abs(turnAt(s[i - 1] as Vec2, s[i] as Vec2, s[i + 1] as Vec2));
      if (turn > (55 * Math.PI) / 180) continue;
      steps += 1;
      if (turn >= FACET_TURN_RAD) facets += 1;
    }
  }
  const facetRatio = steps === 0 ? 0 : facets / steps;
  return (
    `h=${heightPx}px: tracedPolylines=${traced.length} points=${traced.reduce((s, pl) => s + pl.points.length, 0)} | ` +
    `meanDevFromGlyph=${meanDev.toFixed(3)}px maxDev=${maxDev.toFixed(3)}px facetRatio=${(facetRatio * 100).toFixed(1)}%`
  );
}

function densify(polyline: Polyline, step: number): Vec2[] {
  const pts =
    polyline.closed && polyline.points[0] !== undefined
      ? [...polyline.points, polyline.points[0]]
      : [...polyline.points];
  return sampleByArcLength(pts, step);
}

function nearest(p: Vec2, samples: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (const s of samples) best = Math.min(best, Math.hypot(p.x - s.x, p.y - s.y));
  return best;
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

// Even-odd fill of the outline polygons into a black-on-white RGBA bitmap.
function fillOutline(
  reference: ReadonlyArray<Polyline>,
  width: number,
  height: number,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = false;
      const px = x + 0.5;
      const py = y + 0.5;
      for (const pl of reference) {
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

function encodeBmp24(image: RawImageData): Uint8Array {
  const rowBytes = Math.ceil((image.width * 3) / 4) * 4;
  const out = new Uint8Array(54 + rowBytes * image.height);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowBytes * image.height, true);
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
