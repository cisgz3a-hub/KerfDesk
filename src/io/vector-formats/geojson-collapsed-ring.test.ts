// ADR-444 Amendment 1: a contour that collapses on the GeoJSON export grid is
// dropped with its whole subtree, so a hole (or an island) nested in it is
// never orphaned and written with the wrong fill.
//
// All geometry is on a 1 mm grid with an explicit page, so page grid index =
// round(x + 10), round(20 + y) for a scene point (x, -y): the coordinates
// below are page coordinates (y up) and their snapping is easy to check.

import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { contoursKeptAfterCollapse } from './collapsed-ring-subtrees';
import { writeGeoJsonDocument } from './geojson-writer';
import type { VectorFillRule, VectorPaintItem } from './vector-artwork';

/** Closed polygon contour from page points (y up), in the given order. */
function contour(points: ReadonlyArray<Vec2>, reverse = false): CurveSubpath {
  const scene = points.map((p) => ({ x: p.x, y: -p.y }));
  const ordered = reverse ? [...scene].reverse() : scene;
  return {
    start: ordered[0] as Vec2,
    closed: true,
    segments: [...ordered.slice(1), ordered[0] as Vec2].map((to) => ({
      kind: 'line' as const,
      to,
    })),
  };
}

// A band 0.98 mm wide along the line y = x / 2. Every corner snaps onto that
// line ((0, 0) or (8, 4)), so the band collapses on the 1 mm grid.
const BAND: Vec2[] = [
  { x: 0.49, y: -0.49 },
  { x: 8.49, y: 3.51 },
  { x: 7.51, y: 4.49 },
  { x: -0.49, y: 0.49 },
];
// Inside the band; snaps to the real parallelogram (1,0) (7,3) (7,4) (1,1).
const BAND_HOLE: Vec2[] = [
  { x: 1.1, y: 0.2 },
  { x: 7.1, y: 3.2 },
  { x: 6.9, y: 3.8 },
  { x: 0.9, y: 0.8 },
];
// Inside BAND_HOLE; snaps to the real triangle (2,1) (3,1) (4,2), which lies
// inside the snapped hole (touching it at (3,1)).
const HOLE_ISLAND: Vec2[] = [
  { x: 2, y: 1 },
  { x: 2.9, y: 1.2 },
  { x: 4, y: 1.9 },
];
const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
const shift = (points: Vec2[], dx: number, dy: number): Vec2[] =>
  points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

const counterclockwise = (points: Vec2[]): boolean => {
  let twiceArea = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as Vec2;
    twiceArea += a.x * b.y - b.x * a.y;
  });
  return twiceArea > 0;
};
/** Ring with the wanted page orientation (for nonzero: +1 outer, -1 hole). */
const oriented = (points: Vec2[], ccw: boolean): CurveSubpath =>
  contour(points, counterclockwise(points) !== ccw);

type Feature = { geometry: { type: string; coordinates: unknown } };
function polygonsOf(fillRule: VectorFillRule, curves: CurveSubpath[]): number[][][][] {
  const item: VectorPaintItem = { color: '#000000', paint: 'fill', fillRule, curves };
  const document = writeGeoJsonDocument([item], {
    precisionMm: 1,
    page: { minX: -10, minY: -20, maxX: 30, maxY: 20 },
  });
  const { features } = JSON.parse(document.text) as { features: Feature[] };
  return features.flatMap((feature) =>
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]),
  );
}
/** Rings as sorted lists of their distinct page positions (orientation-free). */
const ringKey = (ring: number[][]): string =>
  ring
    .slice(0, -1)
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(' ');
const shape = (polygons: number[][][][]): string[][] =>
  polygons.map((polygon) => polygon.map(ringKey)).sort();
const gridSquare = (x: number, y: number, s: number): string =>
  ringKey([...square(x + 10, y + 20, s), { x: x + 10, y: y + 20 }].map((p) => [p.x, p.y]));

describe('GeoJSON: a grid-collapsed contour takes its subtree with it', () => {
  // A lone square keeps the document non-empty and shows that a collapsed
  // contour never drops a contour it does not contain.
  const LONE = square(12, 0, 2);

  for (const fillRule of ['evenodd', 'nonzero'] as const) {
    it(`drops a hole and its island with their collapsed outer band (${fillRule})`, () => {
      const polygons = polygonsOf(fillRule, [
        oriented(BAND, true),
        oriented(BAND_HOLE, false),
        oriented(HOLE_ISLAND, true),
        oriented(LONE, true),
      ]);
      // Before the fix the hole was written as a filled polygon (with the
      // island as its hole): paper became ink.
      expect(shape(polygons)).toEqual([[gridSquare(12, 0, 2)]]);
    });

    it(`drops an island with its collapsed hole, keeping the outer solid (${fillRule})`, () => {
      const outer = square(-3, -3, 14);
      const polygons = polygonsOf(fillRule, [
        oriented(outer, true),
        oriented(BAND, false),
        oriented(BAND_HOLE, true),
        oriented(LONE, true),
      ]);
      // Before the fix, under even-odd, the island (BAND_HOLE) became a hole
      // of the outer square: ink became paper.
      expect(shape(polygons)).toEqual([[gridSquare(-3, -3, 14)], [gridSquare(12, 0, 2)]].sort());
    });

    it(`keeps the thin band's subtree when the band does not collapse (${fillRule})`, () => {
      // The same nest 10x larger: nothing collapses and the hole stays a hole.
      const scale = (points: Vec2[]): Vec2[] => points.map((p) => ({ x: 10 * p.x, y: 10 * p.y }));
      const polygons = polygonsOf(fillRule, [
        oriented(scale(BAND), true),
        oriented(scale(BAND_HOLE), false),
        oriented(scale(HOLE_ISLAND), true),
      ]);
      expect(polygons).toHaveLength(2);
      expect(polygons.map((polygon) => polygon.length).sort()).toEqual([1, 2]);
    });
  }
});

describe('contoursKeptAfterCollapse', () => {
  it('keeps everything when nothing collapsed', () => {
    expect(contoursKeptAfterCollapse([BAND, BAND_HOLE], [false, false])).toEqual([true, true]);
  });

  it('drops the collapsed contour, every contour inside it, and nothing else', () => {
    const lone = square(12, 0, 2);
    const kept = contoursKeptAfterCollapse(
      [lone, BAND, BAND_HOLE, HOLE_ISLAND, shift(BAND_HOLE, 20, 0)],
      [false, true, false, false, false],
    );
    expect(kept).toEqual([true, false, false, false, true]);
  });

  it('ignores a collapsed contour that encloses no area', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ];
    expect(contoursKeptAfterCollapse([line, BAND_HOLE], [true, false])).toEqual([false, true]);
  });
});
