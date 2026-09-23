import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  fillVectorGroups,
  fillVectorGroupsWithCoverage,
  type VectorFillGroup,
  type VectorFillPath,
} from './rasterize-vector-fill';

const box = (x: number, y: number, width: number, height: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

function group(
  polylines: ReadonlyArray<Polyline>,
  fillRule: VectorFillPath['fillRule'] = 'evenodd',
) {
  return { objects: [{ paths: [{ polylines, fillRule }] }] };
}

function raster(
  groups: ReadonlyArray<VectorFillGroup>,
  width: number,
  height: number,
  ink = 0,
  coverageAxis: 'x' | 'y' = 'x',
) {
  const grid = { luma: new Uint8Array(width * height).fill(255), width, height, ink };
  fillVectorGroupsWithCoverage(
    grid,
    groups,
    { minX: 0, minY: 0, maxX: width, maxY: height },
    1,
    1,
    coverageAxis,
  );
  return grid;
}

describe('coverage-aware vector fill', () => {
  it('preserves pale photo ribbons at 480 pixels that miss every binary pixel centre', () => {
    // At a 2px band pitch, a luma-240 photo occupies 2 * 15/255 px.
    // Each ribbon straddles a pixel boundary and misses both pixel centres.
    const ribbons = Array.from({ length: 240 }, (_, index) =>
      box(index * 2 + 1 - 1 / 17, 0, 2 / 17, 480),
    );
    const groups = [group(ribbons)];
    const covered = raster(groups, 480, 480);
    expect(new Set(covered.luma)).toEqual(new Set([240]));

    const binary = { ...covered, luma: new Uint8Array(480 * 480).fill(255) };
    fillVectorGroups(binary, groups, { minX: 0, minY: 0, maxX: 480, maxY: 480 }, 1, 1);
    expect(new Set(binary.luma)).toEqual(new Set([255]));
  });

  it('preserves pale ribbons rotated by 90 degrees that miss every fixed horizontal subrow', () => {
    const ribbons = Array.from({ length: 240 }, (_, index) =>
      box(0, index * 2 + 1 - 1 / 17, 480, 2 / 17),
    );
    const groups = [group(ribbons)];
    expect(new Set(raster(groups, 480, 480, 0, 'x').luma)).toEqual(new Set([255]));
    expect(new Set(raster(groups, 480, 480, 0, 'y').luma)).toEqual(new Set([240]));
  });

  it.each([23, 45, 78, -61, 133])(
    "preserves a thin ribbon's analytic area at %s degrees",
    (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const sin = Math.sin(radians);
      const cos = Math.cos(radians);
      const width = 2 / 17;
      const height = 80;
      const source = box(-width / 2, -height / 2, width, height);
      const rotated = {
        ...source,
        points: source.points.map((point) => ({
          x: 64 + point.x * cos - point.y * sin,
          y: 64 + point.x * sin + point.y * cos,
        })),
      };
      const axis = Math.abs(sin) > Math.abs(cos) ? 'y' : 'x';
      const result = raster([group([rotated])], 128, 128, 0, axis);
      const area = result.luma.reduce((sum, luma) => sum + (255 - luma) / 255, 0);
      // Rotation preserves this rectangle's known area. The tolerance includes
      // 8-bit luma rounding and four-sample integration at the two short ends.
      expect(Math.abs(area - width * height)).toBeLessThan(width * height * 0.02);
    },
  );

  it.each(['evenodd', 'nonzero'] as const)(
    'keeps %s holes and row indexing when scanning vertically',
    (rule) => {
      const outer = box(0, 0, 2, 3);
      const inner = box(0, 0.25, 2, 2.5);
      const hole = rule === 'nonzero' ? { ...inner, points: [...inner.points].reverse() } : inner;
      const result = raster([group([outer, hole], rule)], 2, 3, 0, 'y');
      expect([...result.luma]).toEqual([191, 191, 255, 255, 191, 191]);
    },
  );

  it('integrates fractional horizontal spans and averages vertical subrows at the chosen ink', () => {
    // Rectangle area 1.5 * 0.5 = 0.75px, split evenly across two pixels.
    const result = raster([group([box(0.25, 0.25, 1.5, 0.5)])], 2, 1, 127);
    expect([...result.luma]).toEqual([207, 207]);
    const coveredArea = result.luma.reduce((sum, luma) => sum + (255 - luma) / (255 - 127), 0);
    expect(coveredArea).toBe(0.75);
  });

  it('retains a sloped edge that the centre scanline misses', () => {
    const triangle: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0.5 },
      ],
    };
    expect([...raster([group([triangle])], 1, 1).luma]).toEqual([191]);
  });

  it.each(['evenodd', 'nonzero'] as const)(
    'preserves fractional hole boundaries with %s fill',
    (rule) => {
      const outer = box(0, 0, 3, 1);
      const inner = box(0.25, 0, 2.5, 1);
      const hole = rule === 'nonzero' ? { ...inner, points: [...inner.points].reverse() } : inner;
      expect([...raster([group([outer, hole], rule)], 3, 1).luma]).toEqual([191, 255, 191]);
      if (rule === 'nonzero') {
        expect([...raster([group([outer, inner], rule)], 3, 1).luma]).toEqual([0, 0, 0]);
      }
    },
  );

  it('unions paths and independent groups before coverage while objects in a group remain even-odd', () => {
    const left = { polylines: [box(0, 0, 0.5, 1)], fillRule: 'evenodd' as const };
    const right = { polylines: [box(0.25, 0, 0.5, 1)], fillRule: 'evenodd' as const };
    const paths = raster([{ objects: [{ paths: [left, right] }] }], 1, 1);
    const groups = raster(
      [{ objects: [{ paths: [left] }] }, { objects: [{ paths: [right] }] }],
      1,
      1,
    );
    const objects = raster([{ objects: [{ paths: [left] }, { paths: [right] }] }], 1, 1);
    expect([...paths.luma]).toEqual([64]);
    expect([...groups.luma]).toEqual([64]);
    expect([...objects.luma]).toEqual([128]);
  });

  it('clips at the grid after transforming source bounds and nonuniform scale', () => {
    const grid = { luma: new Uint8Array(2).fill(255), width: 2, height: 1, ink: 127 };
    fillVectorGroupsWithCoverage(
      grid,
      [group([box(9.75, 19, 0.875, 3)])],
      { minX: 10, minY: 20, maxX: 11, maxY: 21 },
      2,
      1,
    );
    expect([...grid.luma]).toEqual([127, 223]);
  });

  it('ignores open contours and preserves previously painted ink outside the coverage', () => {
    const grid = { luma: new Uint8Array([100, 255]), width: 2, height: 1, ink: 0 };
    fillVectorGroupsWithCoverage(
      grid,
      [group([{ ...box(0, 0, 2, 1), closed: false }, box(1, 0, 0.25, 1)])],
      { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      1,
      1,
    );
    expect([...grid.luma]).toEqual([100, 191]);
  });
});
