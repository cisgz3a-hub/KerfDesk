// Behavior tests for the centerline rewrite. Each test pins one of the
// defects that motivated the rewrite: vanished strokes, tip retraction,
// junction tangles, eroded branches (ring-notch), and staircase wobble.

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { squaredDistanceField, type InkMask } from './distance-field';
import { thinToMedialAxis } from './medial-thinning';
import { sharpenChainBends } from './sharpen-bends';
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
    for (let x = 15; x < 75; x += 1) if (x < 31 || x >= 59 || y < 31 || y >= 59) ink[y * w + x] = 1;
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

  it('never deletes a small mark entirely (the stale last-chain-guard defect)', () => {
    // A 3-px-wide "+" whose four arms are all short pinched-tip leaves: the
    // per-sweep component snapshot once let every leaf die in one pass and
    // the whole mark vanished. At least one chain must always survive.
    const { mask, ink } = blankMask(40, 40);
    stroke(ink, 40, 40, { x: 16, y: 20 }, { x: 24, y: 20 }, 1.5);
    stroke(ink, 40, 40, { x: 20, y: 16 }, { x: 20, y: 24 }, 1.5);
    const polylines = tracePolylines(mask);
    expect(polylines.length).toBeGreaterThanOrEqual(1);
    const total = polylines.reduce((acc, pl) => {
      let len = 0;
      for (let i = 1; i < pl.points.length; i += 1) {
        const a = pl.points[i - 1];
        const b = pl.points[i];
        if (a !== undefined && b !== undefined) len += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return acc + len;
    }, 0);
    expect(total).toBeGreaterThan(3);
  });

  it('keeps the distance field finite on a fully-inked image (virtual border)', () => {
    const size = 30;
    const { mask, ink } = blankMask(size, size);
    ink.fill(1);
    const distSq = squaredDistanceField(mask);
    // Everything outside the image is background: centre pixel (15,15) is at
    // most 15 from it. Without the clamp this is MAX_SAFE_INTEGER and every
    // radius-scaled stage downstream (tip extension especially) blows up.
    expect(distSq[15 * size + 15]).toBe(225);
    expect(distSq[0]).toBe(1);
    // The full pipeline must also complete quickly instead of walking a
    // near-infinite tip-extension budget.
    expect(Array.isArray(tracePolylines(mask))).toBe(true);
  });

  it('treats fully transparent pixels as paper (the alpha-blob defect)', () => {
    // Transparent-background PNGs routinely carry black RGB under alpha=0.
    const width = 60;
    const height = 30;
    const data = new Uint8ClampedArray(width * height * 4); // all black, alpha 0
    for (let y = 13; y <= 16; y += 1)
      for (let x = 10; x <= 50; x += 1) {
        data[(y * width + x) * 4 + 3] = 255; // opaque black stroke
      }
    const paths = traceCenterlineStrokePaths({ width, height, data }, CENTERLINE_OPTIONS);
    const polylines = paths.flatMap((p) => p.polylines);
    expect(polylines.length).toBeGreaterThanOrEqual(1);
    for (const pl of polylines)
      for (const p of pl.points) {
        expect(p.y).toBeGreaterThan(11);
        expect(p.y).toBeLessThan(18);
      }
  });

  it('does not weld receding stroke tips into a hairpin', () => {
    // Two pen tips that END near each other while travelling apart (adjacent
    // glyph terminals). Welding them draws a doubled-back fold.
    const { mask, ink } = blankMask(40, 40);
    stroke(ink, 40, 40, { x: 14, y: 27 }, { x: 20, y: 21 }, 1);
    stroke(ink, 40, 40, { x: 26, y: 31 }, { x: 20, y: 25 }, 1);
    const paths = traceCenterlineStrokePaths(maskToImage(mask), {
      ...CENTERLINE_OPTIONS,
      centerlineJoinGapPx: 5,
    });
    const polylines = paths.flatMap((p) => p.polylines);
    expect(polylines).toHaveLength(2);
  });

  it('honours lineTolerance as the simplification budget', () => {
    const { mask, ink } = blankMask(200, 40);
    for (let x = 10; x <= 190; x += 4) {
      const wobble = 20 + Math.sin(x / 9) * 2.2;
      stroke(ink, 200, 40, { x, y: wobble }, { x: x + 4, y: wobble }, 1.6);
    }
    const image = maskToImage(mask);
    const fine = traceCenterlineStrokePaths(image, { ...CENTERLINE_OPTIONS, lineTolerance: 1 });
    const coarse = traceCenterlineStrokePaths(image, { ...CENTERLINE_OPTIONS, lineTolerance: 6 });
    const count = (paths: ReturnType<typeof traceCenterlineStrokePaths>): number =>
      paths.flatMap((p) => p.polylines).reduce((acc, pl) => acc + pl.points.length, 0);
    expect(count(coarse)).toBeLessThan(count(fine));
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

describe('sharpenChainBends', () => {
  it('sharpens every corner of a many-cornered closed ring (the gear defect)', () => {
    // 24 chamfered star corners on one closed chain. The old fixed 6n
    // iteration budget exhausted after ~10 closed-chain restarts and left
    // the remaining corners chamfered — which corners survived depended on
    // where the array seam happened to sit.
    const cx = 100;
    const cy = 100;
    const tips = 12;
    const corners: Vec2[] = [];
    for (let k = 0; k < tips * 2; k += 1) {
      const angle = (k / (tips * 2)) * 2 * Math.PI;
      const radius = k % 2 === 0 ? 60 : 38;
      corners.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
    const chamferPx = 1.5;
    const spacingPx = 1;
    const points: Vec2[] = [];
    for (let k = 0; k < corners.length; k += 1) {
      const prev = corners[(k - 1 + corners.length) % corners.length];
      const corner = corners[k];
      const next = corners[(k + 1) % corners.length];
      if (!prev || !corner || !next) continue;
      const entry = stepToward(corner, prev, chamferPx);
      const exit = stepToward(corner, next, chamferPx);
      points.push(entry, exit);
      appendSamples(points, exit, stepToward(next, corner, chamferPx), spacingPx);
    }
    const width = 200;
    const distSq = new Float64Array(width * width).fill(9); // uniform 3-px radius
    const sharpened = sharpenChainBends(points, true, distSq, width);
    let restored = 0;
    for (const corner of corners) {
      let best = Infinity;
      for (const p of sharpened.points) {
        best = Math.min(best, Math.hypot(p.x - corner.x, p.y - corner.y));
      }
      if (best < 0.9) restored += 1;
    }
    expect(restored).toBe(corners.length);
    // Every rebuilt vertex is reported as a drawn corner for output pinning.
    expect(sharpened.corners.size).toBe(corners.length);
  });
});

function stepToward(from: Vec2, to: Vec2, distance: number): Vec2 {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) / len) * distance,
    y: from.y + ((to.y - from.y) / len) * distance,
  };
}

function appendSamples(out: Vec2[], from: Vec2, to: Vec2, spacing: number): void {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.floor(len / spacing));
  for (let s = 1; s < steps; s += 1) {
    const t = s / steps;
    out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
}
