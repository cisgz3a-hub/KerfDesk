// AUDIT (2026-07-04): the user reports NEW problems on a re-traced logo —
// serif-foot slivers on HOUSE letters, a notch at the O top, etc. This traces
// the real arch logo via the app's MERGED Edge options and renders high-zoom
// crops of the serifed HOUSE letters and the small LANGEBAAN letters so the
// defects can be seen and characterised (report-only; no fix here).
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_new-problems-audit.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const SLIVER_AREA_MAX_PX2 = 30;
const SLIVER_PERIM_MIN_PX = 12;

function mergedAppEdgeOptions(): TraceOptions {
  return {
    ...(TRACE_PRESETS['Edge Detection'] as TraceOptions),
    edgeLowThresholdRatio: 0.074,
    edgeHighThresholdRatio: 0.185,
    edgeMinLengthPx: 3,
  };
}

type Band = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

// Located by eye from prior crops: HOUSE spans ~x475-945 y552-668; LANGEBAAN
// band is x300-735 y655-728. Generous crops, high zoom.
const CROPS: ReadonlyArray<{ name: string; band: Band; scale: number }> = [
  { name: 'np-house-all', band: { x0: 470, y0: 545, x1: 950, y1: 675 }, scale: 3 },
  { name: 'np-house-H', band: { x0: 470, y0: 545, x1: 600, y1: 675 }, scale: 7 },
  { name: 'np-lang-all', band: { x0: 295, y0: 652, x1: 740, y1: 730 }, scale: 4 },
  // LANGEBAAN's "AA" pair (L-A-N-G-E-B-A-A-N). The user reports one A missing
  // its "mid" (the triangular counter). A correct A = silhouette + counter
  // (2 closed loops); a missing mid = counter loop gone (1 loop).
  { name: 'np-lang-AA', band: { x0: 578, y0: 655, x1: 672, y1: 730 }, scale: 9 },
];

// Count closed loops whose centroid falls in each narrow A column — the
// counter is a closed loop inside the A; its absence is the "no mid" defect.
const A_COLUMNS: ReadonlyArray<{ name: string; x0: number; x1: number }> = [
  { name: 'A1(after L)', x0: 335, x1: 400 },
  { name: 'A2(1st of AA)', x0: 578, x1: 625 },
  { name: 'A3(2nd of AA)', x0: 625, x1: 672 },
];

it('renders new-problem audit crops via merged app options', { timeout: 120000 }, () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  const fixture = requiredArchHouseFixtureStatus();
  if (fixture.path === null) throw new Error('arch-house fixture missing');
  mkdirSync(OUT_DIR, { recursive: true });
  const image = decodePngFile(fixture.path);
  const polylines = traceImageToEdgePaths(image, mergedAppEdgeOptions()).flatMap(
    (p) => p.polylines,
  );
  writeCropRenders(image, polylines);
  writeSliverCensus(polylines);
  writeLumaProbe(image);
  writeCounterCensus(polylines);
});

function writeCropRenders(image: RawImageData, polylines: ReadonlyArray<Polyline>): void {
  for (const crop of CROPS) {
    const inBand = polylines.filter((pl) =>
      pl.points.some(
        (p) =>
          p.x >= crop.band.x0 && p.x <= crop.band.x1 && p.y >= crop.band.y0 && p.y <= crop.band.y1,
      ),
    );
    writeFileSync(
      join(OUT_DIR, `${crop.name}.png`),
      cropRender(image, inBand, crop.band, crop.scale),
    );
  }
}

// Census: tiny closed "sliver" loops (small area but real perimeter) anywhere
// in the two letter bands — the serif-foot artifact signature.
function writeSliverCensus(polylines: ReadonlyArray<Polyline>): void {
  const lines: string[] = ['--- tiny sliver loops (area<=30px2, perim>=12px) in letter bands ---'];
  const bands = [CROPS[0]!.band, CROPS[2]!.band];
  for (const pl of polylines) {
    if (!pl.closed || pl.points.length < 3) continue;
    if (
      !pl.points.some((p) =>
        bands.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1),
      )
    )
      continue;
    const area = Math.abs(signedArea(pl.points));
    const perim = perimeter(pl.points);
    if (area <= SLIVER_AREA_MAX_PX2 && perim >= SLIVER_PERIM_MIN_PX) {
      const c = centroid(pl.points);
      lines.push(
        `sliver area=${area.toFixed(1)} perim=${perim.toFixed(1)} at (${c.x.toFixed(0)},${c.y.toFixed(0)})`,
      );
    }
  }
  writeFileSync(join(OUT_DIR, 'np-slivers.txt'), `${lines.join('\n')}\n`);
}

// Source-luma probe: scan DOWN through a HOUSE serif foot into the white
// below it. If luma stays ~255 the trace bulge is pure overshoot; a dip
// (a faint shadow gradient) means the sensitive Canny is tracing real ink.
// CAUTION when reading the output: HOUSE foot ink ends ~y653 (anti-aliased row
// y654); rows y>=679 in these columns are the LANGEBAAN word below, NOT
// sub-serif contour. Only y655-676 speaks to overshoot-into-white.
function writeLumaProbe(image: RawImageData): void {
  const probe: string[] = ['--- source luma scanning down through HOUSE feet ---'];
  for (const col of [500, 560, 620]) {
    const vals: string[] = [];
    for (let y = 648; y <= 700; y += 4) {
      vals.push(`${y}:${lumaAt(image, col, y)}`);
    }
    probe.push(`x=${col}: ${vals.join(' ')}`);
  }
  writeFileSync(join(OUT_DIR, 'np-luma-probe.txt'), `${probe.join('\n')}\n`);
}

// Per-A counter census: closed loops centred in each A column, split into the
// big silhouette vs small interior counter. A complete A shows both.
function writeCounterCensus(polylines: ReadonlyArray<Polyline>): void {
  const counter: string[] = ['--- A counter census (closed loops per A column) ---'];
  for (const col of A_COLUMNS) {
    const loops = polylines.filter((pl) => {
      if (!pl.closed || pl.points.length < 3) return false;
      const c = centroid(pl.points);
      return c.x >= col.x0 && c.x <= col.x1 && c.y >= 655 && c.y <= 730;
    });
    const areas = loops.map((pl) => Math.abs(signedArea(pl.points))).sort((a, b) => a - b);
    counter.push(
      `${col.name}: closedLoops=${loops.length} areas=[${areas.map((a) => a.toFixed(0)).join(', ')}]`,
    );
  }
  writeFileSync(join(OUT_DIR, 'np-A-counter.txt'), `${counter.join('\n')}\n`);
}

function lumaAt(image: RawImageData, x: number, y: number): number {
  const o = (y * image.width + x) * 4;
  return Math.round(
    0.299 * (image.data[o] ?? 255) +
      0.587 * (image.data[o + 1] ?? 255) +
      0.114 * (image.data[o + 2] ?? 255),
  );
}

function signedArea(pts: ReadonlyArray<Vec2>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (p === undefined || q === undefined) continue;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function perimeter(pts: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (p !== undefined && q !== undefined) total += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return total;
}

function centroid(pts: ReadonlyArray<Vec2>): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function cropRender(
  image: RawImageData,
  polylines: ReadonlyArray<Polyline>,
  band: Band,
  scale: number,
): Uint8Array {
  const w = band.x1 - band.x0;
  const h = band.y1 - band.y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = ((band.y0 + y) * image.width + (band.x0 + x)) * 4;
      const dst = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  const shifted: Polyline[] = polylines.map((pl) => ({
    closed: pl.closed,
    points: pl.points.map((p) => ({ x: p.x - band.x0, y: p.y - band.y0 })),
  }));
  return renderTraceOverlay(
    { width: w, height: h, data },
    [{ color: '#000000', polylines: shifted }],
    scale,
  );
}
