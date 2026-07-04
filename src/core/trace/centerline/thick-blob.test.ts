// Regression for the thick-blob spoke collapse (ADR-100). A filled 12-tip
// star has a fat central hub (inner radius 45 px) with twelve sharp spokes
// radiating out to the outer tips (radius 80 px). Its medial axis is a
// 12-spoke skeleton, so Centerline must emit ~12 strokes that each reach a
// distinct tip. The pre-fix pruner scaled its spur budget by the HUB radius
// (1.6 × 45 ≈ 72 px), so every 32–39 px spoke read as "under budget" and got
// pruned down to a single 2-point polyline (audit apex error mean 51 px).
//
// ADR-100's documented spur rule prunes only PINCHED tips (tip radius ≤ 1.6 px
// AND protrusion beyond the trunk under budget). A 35 px spoke protruding far
// past the hub is a real stroke by that rule — the collapse was a bug, not a
// preference. This pins the spokes' survival directly on the tracer output.

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { traceCenterlineStrokePaths } from './trace-centerline';

const STAR_TIPS = 12;
const STAR_CENTER = 100;
const STAR_OUTER_R = 80;
const STAR_INNER_R = 45;
const STAR_SIZE = 200;
const INK = 0;
const PAPER = 255;

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

// The twelve outer-tip apexes (even indices of the alternating corner ring).
function outerTips(): Vec2[] {
  const tips: Vec2[] = [];
  for (let k = 0; k < STAR_TIPS; k += 1) {
    const angle = ((2 * k) / (STAR_TIPS * 2)) * 2 * Math.PI;
    tips.push({
      x: STAR_CENTER + STAR_OUTER_R * Math.cos(angle),
      y: STAR_CENTER + STAR_OUTER_R * Math.sin(angle),
    });
  }
  return tips;
}

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

// Filled star, built by point-in-polygon fill (matches the audit fixture).
function starImage(): RawImageData {
  const corners = starCorners();
  const data = new Uint8ClampedArray(STAR_SIZE * STAR_SIZE * 4);
  for (let y = 0; y < STAR_SIZE; y += 1) {
    for (let x = 0; x < STAR_SIZE; x += 1) {
      const value = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, corners) ? INK : PAPER;
      const o = (y * STAR_SIZE + x) * 4;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: STAR_SIZE, height: STAR_SIZE, data };
}

function arcLengthOf(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

// The tip apexes a polyline reaches. Straightest-continuation pairing (a
// documented, correct assembly step) fuses each spoke with its opposite into
// one through-stroke across the hub, so a single polyline reaches a tip at
// EACH end. We report the extremal point on each side of the hub centre so a
// through-stroke counts both spokes it traces, not just its single farthest
// point — the assertion is about the spokes existing, not their grouping.
function reachingPoints(polyline: Polyline): Vec2[] {
  let farthest: Vec2 | undefined;
  let farthestD = -1;
  for (const p of polyline.points) {
    const d = Math.hypot(p.x - STAR_CENTER, p.y - STAR_CENTER);
    if (d > farthestD) {
      farthestD = d;
      farthest = p;
    }
  }
  if (farthest === undefined) return [];
  // The opposite spoke's tip is the extremal point on the OTHER side of the
  // hub (negative projection onto the farthest spoke's direction).
  const ax = farthest.x - STAR_CENTER;
  const ay = farthest.y - STAR_CENTER;
  let opposite: Vec2 | undefined;
  let oppositeD = -1;
  for (const p of polyline.points) {
    const proj = (p.x - STAR_CENTER) * ax + (p.y - STAR_CENTER) * ay;
    const d = Math.hypot(p.x - STAR_CENTER, p.y - STAR_CENTER);
    if (proj < 0 && d > oppositeD) {
      oppositeD = d;
      opposite = p;
    }
  }
  return opposite === undefined ? [farthest] : [farthest, opposite];
}

describe('centerline thick-blob spokes (ADR-100)', () => {
  it('traces the 12 star spokes reaching their outer tips', () => {
    const paths = traceCenterlineStrokePaths(starImage(), CENTERLINE_OPTIONS);
    const polylines = paths.flatMap((p) => p.polylines);

    // (a) At least 10 distinct point-runs whose farthest point reaches within
    // 4 px of a DISTINCT outer-tip apex — the spokes exist and reach the tips.
    const tips = outerTips();
    const reached = new Set<number>();
    for (const polyline of polylines) {
      for (const far of reachingPoints(polyline)) {
        for (let t = 0; t < tips.length; t += 1) {
          const tip = tips[t];
          if (tip === undefined || reached.has(t)) continue;
          if (Math.hypot(far.x - tip.x, far.y - tip.y) <= 4) {
            reached.add(t);
            break;
          }
        }
      }
    }
    expect(reached.size).toBeGreaterThanOrEqual(10);

    // (b) Total traced length reflects a 12-spoke skeleton, not a stub.
    const totalLength = polylines.reduce((sum, pl) => sum + arcLengthOf(pl.points), 0);
    expect(totalLength).toBeGreaterThanOrEqual(300);
  });
});
