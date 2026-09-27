import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../../core/scene';
import { writeGeoJsonDocument } from './geojson-writer';
import type { VectorFillRule, VectorPaintItem } from './vector-artwork';

function contour(points: Vec2[]): CurveSubpath {
  const start = points[0];
  if (start === undefined) throw new Error('Fixture needs points');
  return { start, closed: true, segments: points.slice(1).map((to) => ({ kind: 'line', to })) };
}

const BOWTIE = contour([
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
]);
const SQUARE = contour([
  { x: 20, y: 0 },
  { x: 25, y: 0 },
  { x: 25, y: 5 },
  { x: 20, y: 5 },
]);
const item = (curve: CurveSubpath, fillRule: VectorFillRule, color: string): VectorPaintItem => ({
  color,
  fillRule,
  paint: 'fill',
  curves: [curve],
});
type Feature = {
  properties: { color: string; unmerged?: boolean };
  geometry: { type: string; coordinates: number[][][] };
};

describe('GeoJSON zero-net-area filled contours', () => {
  it.each(['evenodd', 'nonzero'] as const)(
    'preserves both bowtie lobes with the crossing warning under %s',
    (fillRule) => {
      // Each triangular lobe paints25mm²; opposite windings cancel only the
      // signed integral, not the visible fill under either supported rule.
      const result = writeGeoJsonDocument([
        item(BOWTIE, fillRule, '#ff0000'),
        item(SQUARE, fillRule, '#000000'),
      ]);
      const features = (JSON.parse(result.text) as { features: Feature[] }).features;
      expect(features).toHaveLength(2);
      expect(result.unmergedItemCount).toBe(1);
      const bowtie = features.find((feature) => feature.properties.color === '#ff0000');
      expect(bowtie?.properties.unmerged).toBe(true);
      expect(bowtie?.geometry.type).toBe('Polygon');
      const ring = bowtie?.geometry.coordinates[0];
      expect(ring?.slice(0, -1)).toEqual(
        expect.arrayContaining([
          [0, 10],
          [10, 0],
          [10, 10],
          [0, 0],
        ]),
      );
      expect(ring?.[0]).toEqual(ring?.at(-1));
      expect(
        features.find((feature) => feature.properties.color === '#000000')?.properties.unmerged,
      ).toBeUndefined();
      expect(() => writeGeoJsonDocument([item(BOWTIE, fillRule, '#ff0000')])).not.toThrow();
    },
  );

  it('still drops a collinear ring with no painted area', () => {
    const flat = contour([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    const result = writeGeoJsonDocument([
      item(flat, 'evenodd', '#ff0000'),
      item(SQUARE, 'evenodd', '#000000'),
    ]);
    expect(result.featureCount).toBe(1);
    expect(result.unmergedItemCount).toBe(0);
  });
});
