import { describe, expect, it } from 'vitest';
import { square } from '../../__fixtures__/square';
import type { Polyline } from '../scene';
import { fillHatchingWithMetadata, type HatchPolyline } from './fill-hatching';

function hatch(polylines: ReadonlyArray<Polyline>, angle = 0, bidirectional = false) {
  return fillHatchingWithMetadata({
    polylines,
    hatchAngleDeg: angle,
    hatchSpacingMm: 1,
    fillRule: 'evenodd',
    bidirectional,
  });
}

function row(lines: ReadonlyArray<HatchPolyline>, y = 1) {
  return lines.filter((line) => line.points[0]?.y === y).map((line) => line.points.map((p) => p.x));
}

describe('even-odd scanline boundary cancellation', () => {
  it('keeps a shared edge inside one continuous hatch', () => {
    expect(row(hatch([square(5), square(5, 5, 0)]))).toEqual([[0, 10]]);
  });

  it('cancels duplicate loops without fragmenting the surrounding ink', () => {
    const duplicate = square(4, 3, 3);
    expect(hatch([duplicate, duplicate])).toEqual([]);
    expect(row(hatch([square(10), duplicate, duplicate]), 5)).toEqual([[0, 10]]);
  });

  it('retains one crossing for odd multiplicity regardless of winding', () => {
    const contour = square(10);
    const reversed = { ...contour, points: [...contour.points].reverse() };
    expect(hatch([contour, reversed, contour])).toEqual(hatch([contour]));
  });

  it('retains holes and the cancellation of overlapping ink', () => {
    expect(row(hatch([square(10), square(4, 3, 3)]), 5)).toEqual([
      [0, 3],
      [7, 10],
    ]);
    expect(row(hatch([square(6), square(6, 4, 0)]))).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it.each([0.00001, 0.02, 2])('preserves a real gap of %s mm', (gap) => {
    expect(row(hatch([square(5), square(5, 5 + gap, 0)]))).toEqual([
      [0, 5],
      [5 + gap, 10 + gap],
    ]);
  });

  it.each([-0.00000025, 0.00000025])('treats a %s mm seam as coincident', (gap) => {
    expect(row(hatch([square(5), square(5, 5 + gap, 0)]))).toEqual([[0, 10 + gap]]);
  });

  it.each([0, 31, 90, 121])(
    'preserves alternating direction and coverage through tiled boundaries at %s degrees',
    (angle) => {
      const tiled = [square(5), square(5, 5, 0), square(5, 0, 5), square(5, 5, 5)];
      const actual = hatch(tiled, angle, true);
      const expected = hatch([square(10)], angle, true);
      expect(actual).toHaveLength(expected.length);
      expect(actual.some((line) => line.reverse)).toBe(true);
      expect(actual.some((line) => !line.reverse)).toBe(true);
      for (const [index, line] of actual.entries()) {
        const reference = expected[index];
        expect(line.reverse).toBe(reference?.reverse);
        for (const [pointIndex, point] of line.points.entries()) {
          expect(point.x).toBeCloseTo(reference?.points[pointIndex]?.x ?? NaN, 8);
          expect(point.y).toBeCloseTo(reference?.points[pointIndex]?.y ?? NaN, 8);
        }
      }
    },
  );
});
