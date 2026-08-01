// Integration: the kerf offset must not hand the emitter sub-micron "needle"
// vertices. Clipper's miter offset leaves near-coincident vertex pairs at
// near-collinear joins; on a dense traced outline that becomes ±1µm reversal
// moves the controller stutters through. offsetClosedPolylinesForKerf now
// collapses them. This test reproduces the raw needles, then proves the public
// offset removes them without distorting the ring.

import { describe, expect, it } from 'vitest';
import { EndType, inflatePathsD, JoinType } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../scene';
import { MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';
import { offsetClosedPolylinesForKerf } from './kerf-offset';
import { pathDToPolyline, polylineToPathD } from './vector-path-tools';

const RADIUS_MM = 30;
const KERF_MM = 1.5875;
const NEEDLE_MM = 0.0015; // ~1µm: below the offset's 1µm emit grid rounding

// A dense, faintly wavy ring — the shape class (a traced outline) whose miter
// offset leaves sub-micron needles at near-collinear joins.
function wavyRing(): Polyline {
  const points: Vec2[] = [];
  for (let i = 0; i < 800; i += 1) {
    const t = (i / 800) * Math.PI * 2;
    const r = RADIUS_MM + 0.002 * Math.sin(i / 0.7); // ±2µm micro-wiggle
    points.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
  }
  return { closed: true, points: [...points, points[0] as Vec2] };
}

function needleCount(polylines: ReadonlyArray<Polyline>): number {
  let n = 0;
  for (const pl of polylines) {
    for (let i = 1; i < pl.points.length; i += 1) {
      const a = pl.points[i - 1] as Vec2;
      const b = pl.points[i] as Vec2;
      if (Math.hypot(b.x - a.x, b.y - a.y) < NEEDLE_MM) n += 1;
    }
  }
  return n;
}

function maxExtent(pl: Polyline): number {
  return Math.max(...pl.points.map((p) => Math.hypot(p.x, p.y)));
}

const RING = wavyRing();

describe('kerf offset needle cleanup', () => {
  it('the raw miter offset leaves sub-micron needles (the bug)', () => {
    const raw = inflatePathsD(
      [polylineToPathD(RING)],
      KERF_MM,
      JoinType.Miter,
      EndType.Polygon,
      2,
      3,
    ).map(pathDToPolyline);
    expect(needleCount(raw)).toBeGreaterThan(50);
  });

  it('offsetClosedPolylinesForKerf removes the needles without distorting the ring', () => {
    const clean = offsetClosedPolylinesForKerf([RING], KERF_MM);
    expect(clean.length).toBeGreaterThan(0);
    // No needles, and every kept segment is at least the minimum.
    expect(needleCount(clean)).toBe(0);
    for (const pl of clean) {
      for (let i = 1; i < pl.points.length; i += 1) {
        const a = pl.points[i - 1] as Vec2;
        const b = pl.points[i] as Vec2;
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(MIN_OFFSET_SEGMENT_MM);
      }
    }
    // Shape preserved: still a ~(radius + kerf) ring, not collapsed or shrunk.
    for (const pl of clean) expect(maxExtent(pl)).toBeGreaterThan(RADIUS_MM + KERF_MM - 0.1);
  });
});
