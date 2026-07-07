// Visual + metric audit for the Arch House Edge Detection defects reported
// 2026-07-03: lumpy curves on turns and small gaps breaking letter outlines.
// Renders eyeball crops (overlay: source grey, closed loops red, open chains
// blue) and writes gap / wobble metrics to trace-audit-artifacts/.
// Gated like the other audit harnesses — run explicitly:
//   TRACE_AUDIT=1 pnpm vitest run src/__fixtures__/perceptual/_arch-house-edge-audit.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { LANGEBAAN_BAND, measureBandExcessTurnPer100Px } from './arch-house-edge-truth';
import { inkDisc, paper, toRawImage } from './procedural-ink';
import { decodePngFile } from './png-decode';
import { renderTraceOverlay } from './render-overlay';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const GAP_REPORT_MAX_PX = 20;
const RESAMPLE_STEP_PX = 1;
const ZIGZAG_MIN_TURN_RAD = (12 * Math.PI) / 180;

type Crop = {
  readonly name: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly scale: number;
};

// The two regions of the maintainer's screenshot plus the main arch curve.
const CROPS: ReadonlyArray<Crop> = [
  { name: 'arch-word', x0: 130, y0: 540, x1: 900, y1: 665, scale: 3 },
  { name: 'langebaan', x0: 290, y0: 655, x1: 745, y1: 730, scale: 5 },
  { name: 'arch-curve', x0: 350, y0: 180, x1: 680, y1: 340, scale: 3 },
  { name: 'house-left', x0: 150, y0: 280, x1: 430, y1: 480, scale: 3 },
  // The ARCH "A" — reported counter gaps (2026-07-03).
  { name: 'arch-A', x0: 118, y0: 552, x1: 258, y1: 668, scale: 6 },
  // The HOUSE "O" — a pure curved letter; the cleanest bowl-smoothness check
  // (reported serif-bowl faceting, 2026-07-04).
  { name: 'house-O', x0: 620, y0: 552, x1: 770, y1: 668, scale: 8 },
];

const RUN_TRACE_AUDIT = process.env['TRACE_AUDIT'] === '1';

it.skipIf(!RUN_TRACE_AUDIT)(
  'renders Arch House Edge Detection crops + gap/wobble metrics',
  () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error('arch-house fixture missing');
    mkdirSync(OUT_DIR, { recursive: true });
    const image = decodePngFile(fixture.path);
    const options = TRACE_PRESETS['Edge Detection'] as TraceOptions;
    const paths = traceImageToEdgePaths(image, options);
    const polylines = paths.flatMap((path) => path.polylines);

    writeFileSync(join(OUT_DIR, 'arch-edge__full.png'), renderTraceOverlay(image, paths, 1));
    for (const crop of CROPS) {
      const cropped = cropImage(image, crop);
      const shifted = shiftPolylines(polylines, crop);
      const png = renderTraceOverlay(
        cropped,
        [{ color: '#000000', polylines: shifted }],
        crop.scale,
      );
      writeFileSync(join(OUT_DIR, `arch-edge__${crop.name}.png`), png);
    }
    writeFileSync(join(OUT_DIR, 'arch-edge__metrics.txt'), buildMetricsReport(polylines));
  },
  240000,
);

function cropImage(image: RawImageData, crop: Crop): RawImageData {
  const width = crop.x1 - crop.x0;
  const height = crop.y1 - crop.y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((crop.y0 + y) * image.width + (crop.x0 + x)) * 4;
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) data[dst + c] = image.data[src + c] ?? 255;
    }
  }
  return { width, height, data };
}

function shiftPolylines(polylines: ReadonlyArray<Polyline>, crop: Crop): Polyline[] {
  const out: Polyline[] = [];
  for (const polyline of polylines) {
    const inside = polyline.points.some(
      (p) => p.x >= crop.x0 && p.x <= crop.x1 && p.y >= crop.y0 && p.y <= crop.y1,
    );
    if (!inside) continue;
    out.push({
      closed: polyline.closed,
      points: polyline.points.map((p) => ({ x: p.x - crop.x0, y: p.y - crop.y0 })),
    });
  }
  return out;
}

const CORNER_TURN_RAD = (55 * Math.PI) / 180;

function buildMetricsReport(polylines: ReadonlyArray<Polyline>): string {
  const closed = polylines.filter((pl) => pl.closed).length;
  const lines: string[] = [
    `polylines=${polylines.length} closed=${closed} open=${polylines.length - closed}`,
    `points=${polylines.reduce((s, pl) => s + pl.points.length, 0)}`,
    '',
    '--- nearly-closed open chains (self end-gap <= 8px, len >= 30px) ---',
  ];
  for (const item of collectNearlyClosed(polylines)) {
    lines.push(
      `selfGap=${item.selfGap.toFixed(2)}px len=${item.length.toFixed(0)}px at (${item.x.toFixed(0)}, ${item.y.toFixed(0)})`,
    );
  }
  lines.push('', `--- langebaan band step-turn stats (1.5px steps, corners >=55deg excluded) ---`);
  const band = bandTurnStats(polylines);
  lines.push(
    `samples=${band.samples} p50=${band.p50.toFixed(1)}deg p90=${band.p90.toFixed(1)}deg max=${band.max.toFixed(1)}deg`,
  );
  lines.push(
    `excessTurnPer100Px=${measureBandExcessTurnPer100Px(polylines, LANGEBAAN_BAND).toFixed(2)}deg (wobble; corners cancel out)`,
  );
  lines.push('', synthProbeReport(), '', '--- open-end gaps (to OTHER geometry, <= 20px) ---');
  for (const gap of collectOpenEndGaps(polylines)) {
    lines.push(
      `gap=${gap.gapPx.toFixed(2)}px at (${gap.x.toFixed(1)}, ${gap.y.toFixed(1)}) chainLen=${gap.chainLength.toFixed(0)}px`,
    );
  }
  lines.push('', '--- wobble (zigzag turn-direction flips >= 12deg per 100px, top 20) ---');
  for (const item of collectWobble(polylines)) {
    lines.push(
      `zigzagPer100=${item.zigzagPer100.toFixed(1)} len=${item.length.toFixed(0)}px ` +
        `closed=${item.closed ? 'y' : 'n'} bbox=(${item.minX.toFixed(0)},${item.minY.toFixed(0)})-(${item.maxX.toFixed(0)},${item.maxY.toFixed(0)})`,
    );
  }
  return `${lines.join('\n')}\n`;
}

type OpenEndGap = {
  readonly x: number;
  readonly y: number;
  readonly gapPx: number;
  readonly chainLength: number;
};

function collectOpenEndGaps(polylines: ReadonlyArray<Polyline>): OpenEndGap[] {
  const gaps: OpenEndGap[] = [];
  for (let i = 0; i < polylines.length; i += 1) {
    const polyline = polylines[i];
    if (polyline === undefined || polyline.closed || polyline.points.length < 2) continue;
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    const length = arcLengthOf(polyline.points);
    for (const end of [first, last]) {
      if (end === undefined) continue;
      const gapPx = nearestOtherDistance(end, polylines, i);
      if (gapPx <= GAP_REPORT_MAX_PX) gaps.push({ x: end.x, y: end.y, gapPx, chainLength: length });
    }
  }
  return gaps.sort((a, b) => a.gapPx - b.gapPx);
}

function nearestOtherDistance(
  p: Vec2,
  polylines: ReadonlyArray<Polyline>,
  ownIndex: number,
): number {
  let best = Infinity;
  for (let i = 0; i < polylines.length; i += 1) {
    if (i === ownIndex) continue;
    const other = polylines[i];
    if (other === undefined) continue;
    const pts = other.points;
    const count = pts.length + (other.closed ? 0 : -1);
    for (let k = 0; k < count; k += 1) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      if (a === undefined || b === undefined) continue;
      best = Math.min(best, pointToSegment(p, a, b));
    }
  }
  return best;
}

type WobbleItem = {
  readonly zigzagPer100: number;
  readonly length: number;
  readonly closed: boolean;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function collectWobble(polylines: ReadonlyArray<Polyline>): WobbleItem[] {
  const items: WobbleItem[] = [];
  for (const polyline of polylines) {
    const samples = resample(polyline, RESAMPLE_STEP_PX);
    const length = arcLengthOf(polyline.points);
    if (samples.length < 5 || length < 10) continue;
    let flips = 0;
    let prevTurn = 0;
    for (let i = 1; i + 1 < samples.length; i += 1) {
      const turn = turnAt(samples[i - 1] as Vec2, samples[i] as Vec2, samples[i + 1] as Vec2);
      if (Math.abs(turn) >= ZIGZAG_MIN_TURN_RAD && Math.abs(prevTurn) >= ZIGZAG_MIN_TURN_RAD) {
        if (Math.sign(turn) !== Math.sign(prevTurn)) flips += 1;
      }
      prevTurn = turn;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polyline.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    items.push({
      zigzagPer100: (flips / length) * 100,
      length,
      closed: polyline.closed,
      minX,
      minY,
      maxX,
      maxY,
    });
  }
  return items.sort((a, b) => b.zigzagPer100 - a.zigzagPer100).slice(0, 20);
}

function resample(polyline: Polyline, step: number): Vec2[] {
  const pts = polyline.closed ? [...polyline.points, polyline.points[0] as Vec2] : polyline.points;
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

function arcLengthOf(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

type NearlyClosed = {
  readonly selfGap: number;
  readonly length: number;
  readonly x: number;
  readonly y: number;
};

function collectNearlyClosed(polylines: ReadonlyArray<Polyline>): NearlyClosed[] {
  const items: NearlyClosed[] = [];
  for (const polyline of polylines) {
    if (polyline.closed || polyline.points.length < 3) continue;
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    if (first === undefined || last === undefined) continue;
    const selfGap = Math.hypot(last.x - first.x, last.y - first.y);
    const length = arcLengthOf(polyline.points);
    if (selfGap <= 8 && length >= 30) {
      items.push({ selfGap, length, x: first.x, y: first.y });
    }
  }
  return items.sort((a, b) => a.selfGap - b.selfGap);
}

function bandTurnStats(polylines: ReadonlyArray<Polyline>): {
  samples: number;
  p50: number;
  p90: number;
  max: number;
} {
  const turns: number[] = [];
  for (const polyline of polylines) {
    const inBand = polyline.points.every(
      (p) =>
        p.x >= LANGEBAAN_BAND.x0 &&
        p.x <= LANGEBAAN_BAND.x1 &&
        p.y >= LANGEBAAN_BAND.y0 &&
        p.y <= LANGEBAAN_BAND.y1,
    );
    if (!inBand || polyline.points.length < 3) continue;
    const samples = resample(polyline, 1.5);
    for (let i = 1; i + 1 < samples.length; i += 1) {
      const turn = Math.abs(
        turnAt(samples[i - 1] as Vec2, samples[i] as Vec2, samples[i + 1] as Vec2),
      );
      if (turn < CORNER_TURN_RAD) turns.push((turn * 180) / Math.PI);
    }
  }
  turns.sort((a, b) => a - b);
  const at = (q: number): number =>
    turns[Math.min(turns.length - 1, Math.floor(q * turns.length))] ?? 0;
  return { samples: turns.length, p50: at(0.5), p90: at(0.9), max: turns.at(-1) ?? 0 };
}

// Synthetic probes: a soft-edged disc (radial deviation = curve smoothness)
// and the same disc's closure state, under the Edge Detection preset.
function synthProbeReport(): string {
  const luma = paper(180, 180);
  inkDisc(luma, 90, 90, 60, 2);
  const options = TRACE_PRESETS['Edge Detection'] as TraceOptions;
  const paths = traceImageToEdgePaths(toRawImage(luma), options);
  const polylines = paths.flatMap((path) => path.polylines);
  const longest = polylines.reduce<Polyline | null>(
    (best, pl) => (best === null || arcLengthOf(pl.points) > arcLengthOf(best.points) ? pl : best),
    null,
  );
  if (longest === null) return '--- disc probe: NO OUTPUT ---';
  const samples = resample(longest, 1);
  const radii = samples.map((p) => Math.hypot(p.x - 90, p.y - 90));
  const mean = radii.reduce((s, r) => s + r, 0) / Math.max(1, radii.length);
  const rms = Math.sqrt(
    radii.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(1, radii.length),
  );
  const maxDev = radii.reduce((m, r) => Math.max(m, Math.abs(r - mean)), 0);
  return (
    `--- disc probe (r=60 soft): closed=${longest.closed ? 'y' : 'n'} ` +
    `meanR=${mean.toFixed(2)} rmsDev=${rms.toFixed(3)} maxDev=${maxDev.toFixed(3)} ` +
    `polylines=${polylines.length} ---`
  );
}
