import { describe, expect, it } from 'vitest';

import { inkDisc, paper, toRawImage } from '../../__fixtures__/perceptual/procedural-ink';
import type { Polyline, Vec2 } from '../scene';
import { TRACE_PRESETS } from './index';
import { traceImageToPotraceColoredPaths } from './potrace-trace';
import type { RawImageData, TraceOptions } from './trace-image';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

// The exact star fixture the apex spec targets: 12 tips, outer radius 80,
// inner radius 45, centered at (100,100) in a 200x200 image. Its outer tips
// subtend ~27deg — sharp enough that potrace's polygon stage blunts them.
const STAR_TIPS = 12;
const STAR_CENTER = 100;
const STAR_OUTER_R = 80;
const STAR_INNER_R = 45;
const STAR_SIZE = 200;

function starCorners(): Vec2[] {
  const corners: Vec2[] = [];
  for (let k = 0; k < STAR_TIPS * 2; k += 1) {
    const angle = (k / (STAR_TIPS * 2)) * 2 * Math.PI;
    const radius = k % 2 === 0 ? STAR_OUTER_R : STAR_INNER_R;
    corners.push({
      x: STAR_CENTER + radius * Math.cos(angle),
      y: STAR_CENTER + radius * Math.sin(angle),
    });
  }
  return corners;
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function starImage(): RawImageData {
  const corners = starCorners();
  const data = new Uint8ClampedArray(STAR_SIZE * STAR_SIZE * 4);
  for (let y = 0; y < STAR_SIZE; y += 1) {
    for (let x = 0; x < STAR_SIZE; x += 1) {
      const v = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, corners) ? 0 : 255;
      const o = (y * STAR_SIZE + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: STAR_SIZE, height: STAR_SIZE, data };
}

// Sample every segment of every closed polyline at ~`spacing`px so that the
// nearest-point search reflects the traced curve, not just its vertices.
function densePathPoints(polylines: ReadonlyArray<Polyline>, spacing: number): Vec2[] {
  const out: Vec2[] = [];
  for (const polyline of polylines) {
    const pts = polyline.points;
    const ring = polyline.closed && pts[0] !== undefined ? [...pts, pts[0]] : [...pts];
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (a === undefined || b === undefined) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return out;
}

function minDistanceToPath(point: Vec2, path: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (const p of path) best = Math.min(best, Math.hypot(p.x - point.x, p.y - point.y));
  return best;
}

describe('snapCornersToInk (via potrace trace)', () => {
  // Pre-fix baseline recorded before wiring snapCornersToInk: the traced outer
  // tips landed mean ~1.00px / max ~2.17px short of the analytic apexes (the
  // official potrace 1.16 binary blunts identically at 0.99/2.03). Snapping the
  // corner vertices outward along the ink bisector must beat that.
  it('recovers the 12 sharp star apexes to within mean<=0.6 / max<=1.2', () => {
    const paths = traceImageToPotraceColoredPaths(starImage(), LINE_ART);
    const polylines = paths.flatMap((path) => path.polylines);
    const dense = densePathPoints(polylines, 0.5);

    let sum = 0;
    let max = 0;
    for (let k = 0; k < STAR_TIPS * 2; k += 2) {
      const tip = starCorners()[k];
      if (tip === undefined) continue;
      const d = minDistanceToPath(tip, dense);
      sum += d;
      max = Math.max(max, d);
    }
    const mean = sum / STAR_TIPS;

    expect(mean).toBeLessThanOrEqual(0.6);
    expect(max).toBeLessThanOrEqual(1.2);
  });

  // Job compilation documents closed segments as "last point equals the first
  // by construction" (job.ts) and the emitters draw points as given — so a
  // snapped ring must keep its explicit closing duplicate or the shape
  // engraves with its final edge missing. The star's corners guarantee the
  // snapper actually rebuilt this ring (the bug only bit rebuilt rings).
  it('returns snapped rings with an explicit closing duplicate (first == last)', () => {
    const paths = traceImageToPotraceColoredPaths(starImage(), LINE_ART);
    const polylines = paths.flatMap((path) => path.polylines);
    expect(polylines.length).toBeGreaterThan(0);
    for (const polyline of polylines) {
      if (!polyline.closed) continue;
      const first = polyline.points[0];
      const last = polyline.points.at(-1);
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (first === undefined || last === undefined) continue;
      expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThanOrEqual(1e-9);
    }
  });

  // Non-regression: a filled axis-aligned square. Its 90deg corners ARE apex
  // candidates (>= the 50deg threshold), so the snapper considers them — but
  // the ink-marching cap forbids stepping past the ink boundary. Assert no
  // traced point overshoots the analytic bounds by more than 0.8px.
  it('does not overshoot a square with 90deg corners', () => {
    const size = 120;
    const x0 = 30;
    const y0 = 30;
    const x1 = 90;
    const y1 = 90;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const inside = x + 0.5 >= x0 && x + 0.5 < x1 && y + 0.5 >= y0 && y + 0.5 < y1;
        const v = inside ? 0 : 255;
        const o = (y * size + x) * 4;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    const image: RawImageData = { width: size, height: size, data };
    const paths = traceImageToPotraceColoredPaths(image, LINE_ART);
    const polylines = paths.flatMap((path) => path.polylines);

    let overshoot = 0;
    for (const polyline of polylines) {
      for (const p of polyline.points) {
        const outX = Math.max(0, x0 - p.x, p.x - x1);
        const outY = Math.max(0, y0 - p.y, p.y - y1);
        overshoot = Math.max(overshoot, Math.hypot(outX, outY));
      }
    }
    expect(overshoot).toBeLessThanOrEqual(0.8);
  });

  // Smooth-curve non-regression: the standard soft disc must not sprout false
  // corners. Radial max deviation must stay at/under the pre-fix 0.343px.
  it('does not fire on the smooth disc (radial maxDev <= 0.36px)', () => {
    const luma = paper(180, 180);
    inkDisc(luma, 90, 90, 60, 2);
    const paths = traceImageToPotraceColoredPaths(toRawImage(luma), LINE_ART);
    const polylines = paths.flatMap((path) => path.polylines);

    let longest: Polyline | null = null;
    let bestLen = -1;
    for (const polyline of polylines) {
      if (polyline.points.length > bestLen) {
        bestLen = polyline.points.length;
        longest = polyline;
      }
    }
    expect(longest).not.toBeNull();
    const dense = densePathPoints(longest === null ? [] : [longest], 0.5);
    const radii = dense.map((p) => Math.hypot(p.x - 90, p.y - 90));
    const mean = radii.reduce((s, r) => s + r, 0) / Math.max(1, radii.length);
    const maxDev = radii.reduce((m, r) => Math.max(m, Math.abs(r - mean)), 0);

    expect(maxDev).toBeLessThanOrEqual(0.36);
  });
});
