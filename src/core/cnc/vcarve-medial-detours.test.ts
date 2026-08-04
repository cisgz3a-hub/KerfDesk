import { describe, expect, it } from 'vitest';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';
import { joinVCarveFloorDetours } from './vcarve-medial-detours';
import { nearestVCarveRouteLink, type VCarveRouteLink } from './vcarve-medial-detour-link';
import {
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function onlyRegion(contours: ReadonlyArray<Polyline>): VCarveMedialRegion {
  const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);
  expect(normalized.kind).toBe('ok');
  if (normalized.kind !== 'ok') throw new Error('Expected normalized V-carve contours.');
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (region === undefined) throw new Error('Expected one normalized V-carve region.');
  return region;
}

function bruteForceNearestLink(
  routes: ReadonlyArray<Polyline>,
  floorPoints: ReadonlyArray<Vec2>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveRouteLink | null {
  let best: VCarveRouteLink | null = null;
  routes.forEach((route, routeIndex) => {
    route.points.forEach((routePoint, routePointIndex) => {
      floorPoints.forEach((floorPoint, floorPointIndex) => {
        const distanceMm = Math.hypot(floorPoint.x - routePoint.x, floorPoint.y - routePoint.y);
        if (best !== null && distanceMm >= best.distanceMm) return;
        if (!vcarveChordInsideRegion(routePoint, floorPoint, region, segments)) return;
        best = { routeIndex, routePointIndex, floorPointIndex, distanceMm };
      });
    });
  });
  return best;
}

function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('V-carve flat-core detour nearest-pair search', () => {
  it('is exactly equivalent to the source-ordered brute-force scan on small fixtures', () => {
    const region = onlyRegion([rectangle(0, 0, 100, 100)]);
    const segments = vcarveBoundarySegments(region);

    for (let seed = 1; seed <= 64; seed += 1) {
      const random = seededUnit(seed);
      const routes = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        closed: false,
        points: Array.from({ length: 1 + Math.floor(random() * 12) }, () => ({
          x: 1 + random() * 98,
          y: 1 + random() * 98,
        })),
      }));
      const floorPoints = Array.from({ length: 1 + Math.floor(random() * 16) }, () => ({
        x: 1 + random() * 98,
        y: 1 + random() * 98,
      }));

      expect(nearestVCarveRouteLink(routes, floorPoints, region, segments)).toEqual(
        bruteForceNearestLink(routes, floorPoints, region, segments),
      );
    }
  });

  it('preserves route-point then floor-point source order for exact-distance ties', () => {
    const region = onlyRegion([rectangle(0, 0, 20, 20)]);
    const segments = vcarveBoundarySegments(region);
    const routes: ReadonlyArray<Polyline> = [
      { closed: false, points: [{ x: 8, y: 10 }] },
      { closed: false, points: [{ x: 12, y: 10 }] },
    ];
    const floorPoints = [
      { x: 10, y: 12 },
      { x: 10, y: 8 },
    ];

    expect(nearestVCarveRouteLink(routes, floorPoints, region, segments)).toEqual({
      routeIndex: 0,
      routePointIndex: 0,
      floorPointIndex: 0,
      distanceMm: Math.hypot(2, 2),
    });
  });

  it('keeps exact chord containment authoritative over geometric proximity', () => {
    const region = onlyRegion([rectangle(0, 0, 100, 20), rectangle(49, 5, 51, 15)]);
    const segments = vcarveBoundarySegments(region);
    const routes: ReadonlyArray<Polyline> = [
      {
        closed: false,
        points: [
          { x: 48, y: 10 },
          { x: 60, y: 10 },
        ],
      },
    ];
    const floorPoints = [{ x: 52, y: 10 }];

    expect(vcarveChordInsideRegion(routes[0]!.points[0]!, floorPoints[0]!, region, segments)).toBe(
      false,
    );
    expect(nearestVCarveRouteLink(routes, floorPoints, region, segments)).toEqual({
      routeIndex: 0,
      routePointIndex: 1,
      floorPointIndex: 0,
      distanceMm: 8,
    });
  });

  it('inserts every connected flat-core circuit without losing its closed loop', () => {
    const region = onlyRegion([rectangle(0, 0, 30, 20)]);
    const segments = vcarveBoundarySegments(region);
    const medialRoutes: ReadonlyArray<Polyline> = [
      {
        closed: false,
        points: [
          { x: 2, y: 10 },
          { x: 15, y: 10 },
          { x: 28, y: 10 },
        ],
      },
    ];
    const floorRoutes = [rectangle(4, 4, 8, 8), rectangle(22, 12, 26, 16)];

    const joined = joinVCarveFloorDetours(medialRoutes, floorRoutes, region, segments);

    expect(joined.unlinkedFloorRoutes).toEqual([]);
    expect(joined.routes).toHaveLength(1);
    const points = joined.routes[0]?.points ?? [];
    for (const floorPoint of floorRoutes.flatMap((route) => route.points)) {
      expect(points.some((point) => point.x === floorPoint.x && point.y === floorPoint.y)).toBe(
        true,
      );
    }
    expect(points).toHaveLength(15);
  });
});
