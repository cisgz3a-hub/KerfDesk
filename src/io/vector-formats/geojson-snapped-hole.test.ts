import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import type { GridPoint } from './vector-artwork';
import { fillRegionPolygons } from './fill-region-rings';
import { writeGeoJsonDocument } from './geojson-writer';

// Audit O2-P1-2 (Oracle audit O1, file-format-truth). Snapping to the export
// grid can push one hole vertex a fraction of a micrometre across a slanted
// parent edge. Containment used to follow the first probe vertex only, so when
// that vertex was the one pushed out, the hole was written as its own filled
// Polygon: other software filled a hole the app and the PDF leave empty.
// Oracle: RFC 7946 section 3.1.6 polygon semantics against the even-odd
// region of the source contours, whose hole lies wholly inside its parent.

function contour(points: ReadonlyArray<Vec2>): CurveSubpath {
  const start = points[0] as Vec2;
  return { start, closed: true, segments: points.slice(1).map((to) => ({ kind: 'line', to })) };
}

const OUTER: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 10, y: 3 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
// Every vertex is inside OUTER: (5.0016, 1.50049) sits 0.00031 mm above the
// edge y = 0.3 x. On the 0.001 mm grid it snaps to (5.002, 1.500), just below.
const HOLE: ReadonlyArray<Vec2> = [
  { x: 5.0016, y: 1.50049 },
  { x: 8, y: 2.6 },
  { x: 8, y: 6 },
  { x: 5.0016, y: 6 },
];

function rotations<T>(ring: ReadonlyArray<T>): T[][] {
  return ring.map((_, shift) => [...ring.slice(shift), ...ring.slice(0, shift)]);
}

describe('GeoJSON hole containment after grid snapping (O2-P1-2)', () => {
  it.each(rotations(HOLE).map((hole, shift) => [shift, hole] as const))(
    'keeps the hole a hole whichever vertex the ring starts on (start %i)',
    (_shift, hole) => {
      const result = writeGeoJsonDocument([
        {
          color: '#000000',
          fillRule: 'evenodd',
          paint: 'fill',
          curves: [contour(OUTER), contour(hole)],
        },
      ]);
      const features = (
        JSON.parse(result.text) as {
          features: { geometry: { type: string; coordinates: unknown[] } }[];
        }
      ).features;
      expect(features).toHaveLength(1);
      expect(features[0]?.geometry.type).toBe('Polygon');
      expect(features[0]?.geometry.coordinates).toHaveLength(2);
    },
  );

  it('decides containment by most probes, not by the first one', () => {
    // Integer grid rings (micrometres): the hole's first vertex lies just
    // outside the slanted edge y = 0.3 x; its other three are well inside.
    const outer: GridPoint[] = [
      { x: 0, y: 0 },
      { x: 10_000, y: 3_000 },
      { x: 10_000, y: 10_000 },
      { x: 0, y: 10_000 },
    ];
    const hole: GridPoint[] = [
      { x: 5_002, y: 1_500 },
      { x: 8_000, y: 2_600 },
      { x: 8_000, y: 6_000 },
      { x: 5_002, y: 6_000 },
    ];
    const region = fillRegionPolygons([outer, hole], 'evenodd');
    expect(region.polygons).toEqual([{ outer: 0, holes: [1] }]);
  });
});
