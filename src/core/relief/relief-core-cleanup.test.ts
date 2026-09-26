import { describe, expect, it } from 'vitest';
import { buildOffsetLadder, insetContoursChecked } from '../geometry/offset-ladder';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';
import type { Polyline, Vec2 } from '../scene';
import { reliefCoreCleanup } from './relief-core-cleanup';

// A 1/4" end mill, as in ADR-289 Amendment 1's example.
const RADIUS_MM = 3.175;
const MAX_RINGS = 4096;

function polygon(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points };
}

function square(minMm: number, sizeMm: number): Polyline {
  return polygon([
    { x: minMm, y: minMm },
    { x: minMm + sizeMm, y: minMm },
    { x: minMm + sizeMm, y: minMm + sizeMm },
    { x: minMm, y: minMm + sizeMm },
  ]);
}

function circle(cx: number, cy: number, radiusMm: number, clockwise = false): Polyline {
  const points = Array.from({ length: 96 }, (_, index) => {
    const angle = ((clockwise ? -index : index) / 96) * 2 * Math.PI;
    return { x: cx + radiusMm * Math.cos(angle), y: cy + radiusMm * Math.sin(angle) };
  });
  return polygon(points);
}

// Two round lobes joined by a narrow neck: the region splits into lobes as
// the rings step in, so each lobe keeps its own centre.
function dumbbell(): Polyline {
  const lobe = (cx: number, from: number, to: number): Vec2[] =>
    Array.from({ length: 49 }, (_, index) => {
      const angle = from + ((to - from) * index) / 48;
      return { x: cx + 12 * Math.cos(angle), y: 12 * Math.sin(angle) };
    });
  const neck = Math.asin(3 / 12);
  return polygon([
    ...lobe(-20, neck, 2 * Math.PI - neck),
    ...lobe(20, Math.PI + neck, 3 * Math.PI - neck),
  ]);
}

function cleanupFor(region: ReadonlyArray<Polyline>, stepoverPercent: number) {
  const stepMm = (stepoverPercent / 100) * 2 * RADIUS_MM;
  const ladder = buildOffsetLadder(region, MAX_RINGS, (step) => step * stepMm);
  return { ladder, cleanup: reliefCoreCleanup(region, ladder, stepMm, RADIUS_MM) };
}

// The widest stock the cutter misses: twice the deepest inset of the region
// left after subtracting every path's sweep.
function thickestMissMm(region: ReadonlyArray<Polyline>, paths: ReadonlyArray<Polyline>): number {
  const swept = roundStrokeOutline(paths, 2 * RADIUS_MM);
  if (swept === null) throw new Error('sweep failed');
  const missed = differenceClosedPolylinesChecked(region, swept);
  if (missed.kind === 'error') throw new Error('difference failed');
  let low = 0;
  let high = 20;
  for (let i = 0; i < 30; i += 1) {
    const mid = (low + high) / 2;
    if (insetContoursChecked(missed.value, mid).contours.length > 0) low = mid;
    else high = mid;
  }
  return 2 * low;
}

function insideRegion(point: Vec2, region: ReadonlyArray<Polyline>): boolean {
  return region.filter((contour) => pointInPolygon(point, contour.points)).length % 2 === 1;
}

describe('reliefCoreCleanup', () => {
  it('adds nothing at or below a 50% stepover, where the sweeps overlap to the centre', () => {
    for (const stepoverPercent of [40, 50]) {
      const { ladder, cleanup } = cleanupFor([square(0, 20)], stepoverPercent);
      expect(cleanup).toEqual({ paths: [], offsetFailed: false, passLimited: false });
      expect(thickestMissMm([square(0, 20)], ladder.rings.flat())).toBe(0);
    }
  });

  it('clears the core the innermost ring leaves: one ring at the centre', () => {
    // 85% of 6.35 mm: rings at insets 0 and 5.3975 mm, whose sweep stops
    // 1.43 mm short of the centre of a 20 mm square.
    const region = [square(0, 20)];
    const { ladder, cleanup } = cleanupFor(region, 85);
    expect(ladder.rings).toHaveLength(2);
    expect(thickestMissMm(region, ladder.rings.flat())).toBeGreaterThan(2.8);

    expect(cleanup.offsetFailed).toBe(false);
    expect(cleanup.paths).toHaveLength(1);
    for (const point of cleanup.paths[0]?.points ?? []) {
      expect(Math.hypot(point.x - 10, point.y - 10)).toBeLessThan(0.02);
    }
    expect(thickestMissMm(region, [...ladder.rings.flat(), ...cleanup.paths])).toBe(0);
  });

  it('adds nothing where the rings already reach the centre', () => {
    // A 13 mm square at 85%: the second ring passes 1.1 mm from the centre.
    const { cleanup } = cleanupFor([square(0, 13)], 85);
    expect(cleanup).toEqual({ paths: [], offsetFailed: false, passLimited: false });
  });

  it('clears split lobes, islands and corner cusps up to a 150% stepover', () => {
    const regions: ReadonlyArray<ReadonlyArray<Polyline>> = [
      [dumbbell()],
      [circle(0, 0, 14), circle(34, 0, 7)],
      [square(0, 40), circle(20, 20, 6, true)],
    ];
    for (const [regionIndex, region] of regions.entries()) {
      for (const stepoverPercent of [60, 85, 100, 150]) {
        const { ladder, cleanup } = cleanupFor(region, stepoverPercent);
        const paths = [...ladder.rings.flat(), ...cleanup.paths];
        expect(cleanup.offsetFailed).toBe(false);
        // Nothing left but hairlines where two sweeps just meet.
        expect(
          thickestMissMm(region, paths),
          `region ${regionIndex} at ${stepoverPercent}%: ${cleanup.paths.length} added`,
        ).toBeLessThanOrEqual(0.02);
        // Every added path stays in the region the heightmap proved safe.
        for (const path of cleanup.paths) {
          for (const point of path.points) expect(insideRegion(point, region)).toBe(true);
        }
      }
    }
  });

  it('keeps a truncated ladder as it is', () => {
    const region = [square(0, 20)];
    const stepMm = 0.85 * 2 * RADIUS_MM;
    const capped = buildOffsetLadder(region, 1, (step) => step * stepMm);
    expect(capped.capped).toBe(true);
    expect(reliefCoreCleanup(region, capped, stepMm, RADIUS_MM)).toEqual({
      paths: [],
      offsetFailed: false,
      passLimited: false,
    });
  });
});
