// ADR-468 Amendment 1: a contour that collapses on the GeoJSON export grid is
// dropped with its whole subtree, so a hole (or an island) nested in it is
// never orphaned and written with the wrong fill.
//
// All geometry is on a 1 mm grid with an explicit page, so page grid index =
// round(x + 10), round(20 + y) for a scene point (x, -y): the coordinates
// below are page coordinates (y up) and their snapping is easy to check.

import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { collapsesOnGrid, contoursKeptAfterCollapse } from './collapsed-ring-subtrees';
import { writeEpsDocument } from './eps-writer';
import { writeGeoJsonDocument } from './geojson-writer';
import { writePdfDocument } from './pdf-writer';
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
const PAGE_OPTIONS = { precisionMm: 1, page: { minX: -10, minY: -20, maxX: 30, maxY: 20 } };
function polygonsOf(fillRule: VectorFillRule, curves: CurveSubpath[]): number[][][][] {
  const item: VectorPaintItem = { color: '#000000', paint: 'fill', fillRule, curves };
  const document = writeGeoJsonDocument([item], PAGE_OPTIONS);
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

// A triangle of 5.8 mm² with only its vertex (4, 2) inside the band: it
// crosses the band and must be kept whichever vertex it starts at.
const CROSSING: Vec2[] = [
  { x: 4, y: 2 },
  { x: 8, y: -0.4 },
  { x: 8, y: 2.5 },
];
const rotate = (points: Vec2[], by: number): Vec2[] => [
  ...points.slice(by),
  ...points.slice(0, by),
];

describe('a collapsed contour drops only what lies wholly inside it', () => {
  for (const fillRule of ['evenodd', 'nonzero'] as const) {
    for (const start of [0, 1, 2]) {
      it(`keeps a triangle crossing the collapsed band (${fillRule}, start ${start})`, () => {
        const polygons = polygonsOf(fillRule, [
          oriented(BAND, true),
          contour(rotate(CROSSING, start)),
          oriented(square(12, 0, 2), true),
        ]);
        const triangle = ringKey([
          [14, 22],
          [18, 20],
          [18, 23],
          [14, 22],
        ]);
        expect(shape(polygons)).toEqual([[gridSquare(12, 0, 2)], [triangle]].sort());
      });
    }

    it(`keeps islands in the lobes of a zero-area bow-tie (${fillRule})`, () => {
      // Snaps to (0,0) (10,10) (10,0) (0,10): zero net area, but not
      // collinear. It crosses itself and is not a collapsed container.
      for (const corner of [
        { x: 10, y: 0.1 },
        { x: 10.1, y: 0 },
      ]) {
        const bowTie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, corner, { x: 0, y: 10 }];
        const item: VectorPaintItem = {
          color: '#000000',
          paint: 'fill',
          fillRule,
          curves: [
            contour(bowTie),
            oriented(square(0.5, 4, 2), false),
            oriented(square(7.5, 4, 2), false),
            oriented(square(12, 0, 2), true),
          ],
        };
        const document = writeGeoJsonDocument([item], PAGE_OPTIONS);
        const keys = new Set(
          (JSON.parse(document.text) as { features: Feature[] }).features.flatMap((feature) =>
            (feature.geometry.type === 'Polygon'
              ? [feature.geometry.coordinates as number[][][]]
              : (feature.geometry.coordinates as number[][][][])
            ).flatMap((polygon) => polygon.map(ringKey)),
          ),
        );
        expect(
          keys.has(
            ringKey([
              [11, 24],
              [13, 24],
              [13, 26],
              [11, 26],
              [11, 24],
            ]),
          ),
        ).toBe(true);
        expect(
          keys.has(
            ringKey([
              [18, 24],
              [20, 24],
              [20, 26],
              [18, 26],
              [18, 24],
            ]),
          ),
        ).toBe(true);
        expect(document.unmergedItemCount).toBe(1);
      }
    });
  }
});

describe('PDF and EPS drop a collapsed contour with its subtree, as GeoJSON does', () => {
  /** The grid points each subpath starts at ("x y m"). */
  const moves = (text: string): string[] =>
    [...text.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) m(?=\s)/g)].map(
      (match) => `${match[1]},${match[2]}`,
    );

  for (const fillRule of ['evenodd', 'nonzero'] as const) {
    it(`paints neither the hole nor its island of a collapsed band (${fillRule})`, () => {
      const item: VectorPaintItem = {
        color: '#000000',
        paint: 'fill',
        fillRule,
        curves: [
          oriented(BAND, true),
          oriented(BAND_HOLE, false),
          oriented(HOLE_ISLAND, true),
          oriented(square(12, 0, 2), true),
        ],
      };
      // Only the lone square is painted; before, the hole's parallelogram
      // (starting at 11 20 or 11 21) was painted as ink.
      expect(moves(writePdfDocument([item], PAGE_OPTIONS).text)).toEqual(['22,20']);
      expect(moves(writeEpsDocument([item], PAGE_OPTIONS).text)).toEqual(['22,20']);
      expect(shape(polygonsOf(fillRule, item.curves as CurveSubpath[]))).toEqual([
        [gridSquare(12, 0, 2)],
      ]);
    });
  }

  it('still strokes a collapsed contour: only fills drop it', () => {
    const item: VectorPaintItem = {
      color: '#000000',
      paint: 'stroke',
      fillRule: 'evenodd',
      curves: [oriented(BAND, true), oriented(BAND_HOLE, false)],
    };
    expect(moves(writePdfDocument([item], PAGE_OPTIONS).text)).toHaveLength(2);
  });
});

describe('collapse and containment details', () => {
  it('treats only collinear or degenerate written points as collapsed', () => {
    const p = (x: number, y: number): Vec2 => ({ x, y });
    expect(collapsesOnGrid([])).toBe(true);
    expect(collapsesOnGrid([p(1, 1), p(1, 1), p(1, 1)])).toBe(true);
    expect(collapsesOnGrid([p(0, 0), p(8, 4), p(4, 2), p(0, 0)])).toBe(true);
    // A bow-tie has zero net area but is not collapsed.
    expect(collapsesOnGrid([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(false);
  });

  it('keeps a contour that touches the collapsed band only along its boundary', () => {
    // Shares the band's lower edge; every other probe is outside the band.
    const touching = [BAND[0] as Vec2, BAND[1] as Vec2, { x: 8, y: -3 }];
    expect(contoursKeptAfterCollapse([BAND, touching], [true, false])).toEqual([false, true]);
  });

  it('drops a duplicate lying wholly on the collapsed boundary', () => {
    expect(contoursKeptAfterCollapse([BAND, [...BAND].reverse()], [true, false])).toEqual([
      false,
      false,
    ]);
  });
});
