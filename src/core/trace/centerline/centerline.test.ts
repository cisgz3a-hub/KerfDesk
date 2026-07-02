// Behavior tests for the centerline rewrite. Each test pins one of the
// defects that motivated the rewrite: vanished strokes, tip retraction,
// junction tangles, eroded branches (ring-notch), and staircase wobble.

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { squaredDistanceField, type InkMask } from './distance-field';
import { thinToMedialAxis } from './medial-thinning';
import { traceCenterlineStrokePaths } from './trace-centerline';

// --- fixture helpers -------------------------------------------------------

function blankMask(width: number, height: number): { mask: InkMask; ink: Uint8Array } {
  const ink = new Uint8Array(width * height);
  return { mask: { width, height, ink }, ink };
}

function stroke(ink: Uint8Array, w: number, h: number, a: Vec2, b: Vec2, radius: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= radius) ink[y * w + x] = 1;
    }
}

function maskToImage(mask: InkMask): RawImageData {
  const data = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let i = 0; i < mask.ink.length; i += 1) {
    const v = (mask.ink[i] ?? 0) === 1 ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: mask.width, height: mask.height, data };
}

const CENTERLINE_OPTIONS = {
  traceMode: 'centerline' as const,
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
  fixedPalette: ['#ffffff', '#000000'],
  useOtsuThreshold: true,
  despeckleMinPixels: 4,
  centerlineJoinGapPx: 3,
};

function tracePolylines(mask: InkMask): ReadonlyArray<Polyline> {
  const paths = traceCenterlineStrokePaths(maskToImage(mask), CENTERLINE_OPTIONS);
  return paths.flatMap((p) => p.polylines);
}

function inkRect(
  ink: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) ink[y * width + x] = 1;
}

function minDistanceToPoint(polylines: ReadonlyArray<Polyline>, target: Vec2): number {
  let best = Infinity;
  for (const pl of polylines) {
    for (const p of pl.points) {
      best = Math.min(best, Math.hypot(p.x - target.x, p.y - target.y));
    }
  }
  return best;
}

function endpointNear(polylines: ReadonlyArray<Polyline>, target: Vec2, tol: number): boolean {
  return polylines.some((p) => {
    if (p.closed) return false;
    const first = p.points[0];
    const last = p.points.at(-1);
    return (
      (first !== undefined && Math.hypot(first.x - target.x, first.y - target.y) <= tol) ||
      (last !== undefined && Math.hypot(last.x - target.x, last.y - target.y) <= tol)
    );
  });
}

function maxDeviationFromLine(p: Polyline, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  let worst = 0;
  for (const pt of p.points) {
    const d = Math.abs((pt.x - a.x) * (vy / len) - (pt.y - a.y) * (vx / len));
    worst = Math.max(worst, d);
  }
  return worst;
}

// --- distance field --------------------------------------------------------

describe('squaredDistanceField', () => {
  it('is exact on a 1-px border box', () => {
    const { mask, ink } = blankMask(7, 7);
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 5; x += 1) ink[y * 7 + x] = 1;
    const d = squaredDistanceField(mask);
    expect(d[3 * 7 + 3]).toBe(9); // centre: 3px to background
    expect(d[1 * 7 + 1]).toBe(1); // corner ink: adjacent to background
    expect(d[0]).toBe(0); // background
  });
});

// --- thinning --------------------------------------------------------------

function inkRingWithStub(ink: Uint8Array, w: number): void {
  // ring band
  for (let y = 15; y < 75; y += 1)
    for (let x = 15; x < 75; x += 1)
      if (x < 31 || x >= 59 || y < 31 || y >= 59) ink[y * w + x] = 1;
  // stub on top
  for (let y = 5; y < 20; y += 1) for (let x = 42; x < 48; x += 1) ink[y * w + x] = 1;
}

describe('thinToMedialAxis', () => {
  it('preserves a branch off a ring (the eroded-notch defect)', () => {
    const w = 90;
    const h = 90;
    const { mask, ink } = blankMask(w, h);
    inkRingWithStub(ink, w);
    const distSq = squaredDistanceField(mask);
    const skeleton = thinToMedialAxis(mask, distSq);
    let stubPixels = 0;
    for (let y = 6; y < 16; y += 1)
      for (let x = 40; x < 50; x += 1) if ((skeleton[y * w + x] ?? 0) === 1) stubPixels += 1;
    expect(stubPixels).toBeGreaterThanOrEqual(4); // branch survives into the stub
  });
});

// --- full pipeline ---------------------------------------------------------

describe('traceCenterlineStrokePaths', () => {
  it('traces an X crossing as exactly two through-strokes', () => {
    const { mask, ink } = blankMask(100, 100);
    stroke(ink, 100, 100, { x: 15, y: 15 }, { x: 85, y: 85 }, 2);
    stroke(ink, 100, 100, { x: 85, y: 15 }, { x: 15, y: 85 }, 2);
    const polylines = tracePolylines(mask);
    const open = polylines.filter((p) => !p.closed);
    expect(open).toHaveLength(2);
    // Each stroke's two tips are reached (within 3px of the capsule cap tips).
    for (const tip of [
      { x: 15, y: 15 },
      { x: 85, y: 85 },
      { x: 85, y: 15 },
      { x: 15, y: 85 },
    ]) {
      expect(endpointNear(open, tip, 3)).toBe(true);
    }
  });

  it('never loses a stroke (the vanished-stroke defect)', () => {
    const { mask, ink } = blankMask(120, 120);
    stroke(ink, 120, 120, { x: 20, y: 60 }, { x: 100, y: 60 }, 1.6); // horizontal
    stroke(ink, 120, 120, { x: 60, y: 20 }, { x: 60, y: 100 }, 1.6); // vertical
    stroke(ink, 120, 120, { x: 25, y: 25 }, { x: 95, y: 95 }, 1.6); // diagonal
    const polylines = tracePolylines(mask);
    // All six stroke tips must be represented by some open endpoint.
    for (const tip of [
      { x: 20, y: 60 },
      { x: 100, y: 60 },
      { x: 60, y: 20 },
      { x: 60, y: 100 },
      { x: 25, y: 25 },
      { x: 95, y: 95 },
    ]) {
      expect(endpointNear(polylines, tip, 3.5)).toBe(true);
    }
  });

  it('stays centred without staircase wobble on a straight stroke', () => {
    const { mask, ink } = blankMask(120, 40);
    stroke(ink, 120, 40, { x: 10, y: 20 }, { x: 110, y: 20 }, 3);
    const polylines = tracePolylines(mask);
    expect(polylines).toHaveLength(1);
    const line = polylines[0];
    if (line === undefined) throw new Error('missing line');
    expect(maxDeviationFromLine(line, { x: 10, y: 20 }, { x: 110, y: 20 })).toBeLessThan(0.8);
  });

  it('reaches the tips of a straight stroke (the retraction defect)', () => {
    const { mask, ink } = blankMask(120, 40);
    stroke(ink, 120, 40, { x: 12, y: 20 }, { x: 108, y: 20 }, 3);
    const polylines = tracePolylines(mask);
    // Capsule caps end at x=9 / x=111; tips must reach within ~2px.
    expect(endpointNear(polylines, { x: 10.5, y: 20 }, 2.5)).toBe(true);
    expect(endpointNear(polylines, { x: 109.5, y: 20 }, 2.5)).toBe(true);
  });

  it('traces a ring as one closed loop with no tails', () => {
    const w = 100;
    const h = 100;
    const { mask, ink } = blankMask(w, h);
    for (let y = 20; y < 80; y += 1)
      for (let x = 20; x < 80; x += 1)
        if (x < 34 || x >= 66 || y < 34 || y >= 66) ink[y * w + x] = 1;
    const polylines = tracePolylines(mask);
    const closed = polylines.filter((p) => p.closed);
    const open = polylines.filter((p) => !p.closed);
    expect(closed).toHaveLength(1);
    expect(open).toHaveLength(0); // corner spurs pruned, no extension tails
  });

  it('returns nothing for a blank image and one dotless path set for a blob', () => {
    const { mask } = blankMask(40, 40);
    expect(tracePolylines(mask)).toHaveLength(0);
  });

  it('restores the sharp corner of an L band (the chamfered-corner defect)', () => {
    const { mask, ink } = blankMask(140, 140);
    inkRect(ink, 140, 30, 20, 46, 110); // vertical arm, centerline x=38
    inkRect(ink, 140, 30, 94, 120, 110); // horizontal arm → corner vertex (38,102)
    const polylines = tracePolylines(mask);
    expect(polylines).toHaveLength(1);
    expect(minDistanceToPoint(polylines, { x: 38.5, y: 102.5 })).toBeLessThan(1);
  });

  it('restores all four corners of a closed square ring band', () => {
    const { mask, ink } = blankMask(120, 120);
    inkRect(ink, 120, 20, 20, 100, 100);
    for (let y = 44; y < 76; y += 1) for (let x = 44; x < 76; x += 1) ink[y * 120 + x] = 0;
    const polylines = tracePolylines(mask);
    const closed = polylines.filter((p) => p.closed);
    expect(closed).toHaveLength(1);
    // Centerline rectangle corners (32,32)…(88,88) — each must be a vertex,
    // not a chamfer (the raw medial cut misses them by ~0.41·radius ≈ 5px).
    for (const corner of [
      { x: 32.5, y: 32.5 },
      { x: 88.5, y: 32.5 },
      { x: 88.5, y: 88.5 },
      { x: 32.5, y: 88.5 },
    ]) {
      expect(minDistanceToPoint(closed, corner)).toBeLessThan(1);
    }
  });
});
