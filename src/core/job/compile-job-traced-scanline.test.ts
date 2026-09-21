import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import * as polygon from '../geometry/polygon-difference';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Polyline,
  type TracedImage,
} from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup } from './job';

const color = '#000000';
const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
const layer = {
  ...createLayer({ id: 'trace-fill', color }),
  mode: 'fill' as const,
  hatchSpacingMm: 1,
  hatchAngleDeg: 0,
  fillBidirectional: false,
};
const square = (x: number, y: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});
const trace = (paths: ReadonlyArray<ColoredPath>): TracedImage => ({
  kind: 'traced-image',
  id: 'trace',
  source: 'dense.png',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  transform: IDENTITY_TRANSFORM,
  paths,
});
function fill(paths: ReadonlyArray<ColoredPath>): FillGroup {
  const group = compileJob({ objects: [trace(paths)], layers: [layer] }, device).groups[0];
  if (group?.kind !== 'fill') throw new Error('Expected a fill');
  return group;
}
function row(group: FillGroup, y: number) {
  return group.segments
    .filter((segment) => segment.polyline[0]?.y === y)
    .map((segment) => segment.polyline.map((point) => point.x));
}

afterEach(() => vi.restoreAllMocks());

describe('scanline compilation of a single even-odd trace', () => {
  it('fills a dense trace without allocating a polygon boolean arrangement', () => {
    const evenOdd = vi.spyOn(polygon, 'normalizeClosedPolylinesEvenOddChecked');
    const nonZero = vi.spyOn(polygon, 'normalizeClosedPolylinesNonZeroChecked');
    const count = 150_000; // Also exceeds V8's spread-call argument budget.
    const polylines = Array.from({ length: count }, (_, i) => square(i * 2, 0, 1));
    const result = fill([{ color, polylines }]);
    expect(result.segments).toHaveLength(count);
    expect(result.segments[0]?.polyline).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(result.segments.at(-1)?.polyline).toEqual([
      { x: count * 2 - 2, y: 0 },
      { x: count * 2 - 1, y: 0 },
    ]);
    expect(evenOdd).not.toHaveBeenCalled();
    expect(nonZero).not.toHaveBeenCalled();
  });

  it('preserves nested holes and cancels overlapping ink within the same path', () => {
    const donut = fill([{ color, polylines: [square(0, 0, 10), square(3, 3, 4)] }]);
    expect(row(donut, 5)).toEqual([
      [0, 3],
      [7, 10],
    ]);
    const overlap = fill([{ color, polylines: [square(0, 0, 6), square(4, 0, 6)] }]);
    expect(row(overlap, 3)).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it('keeps touching ink as one continuous span without a seam stop', () => {
    const result = fill([{ color, polylines: [square(0, 0, 5), square(5, 0, 5)] }]);
    expect(row(result, 2)).toEqual([[0, 10]]);
  });

  it('resolves self-intersections directly on each scanline', () => {
    const bowTie: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ],
    };
    const result = fill([{ color, polylines: [bowTie] }]);
    expect(row(result, 2)).toEqual([[2, 8]]);
    expect(row(result, 5)).toEqual([]);
    expect(row(result, 8)).toEqual([[2, 8]]);
  });

  it('uses source boundaries without polygon-union quantization changing the hatch row', () => {
    const result = fill([{ color, polylines: [square(0, 0.0004, 2)] }]);
    // The source lies above y=0 and includes y=2. Rounding its contour to
    // Clipper's micron grid used to move those boundaries before hatching.
    expect(row(result, 0)).toEqual([]);
    expect(row(result, 1)).toEqual([[0, 2]]);
    expect(row(result, 2)).toEqual([[0, 2]]);
  });

  it('still unions independent paths and honours explicit non-zero winding', () => {
    const contours = [square(0, 0, 6), square(4, 0, 6)];
    const independent = fill(contours.map((contour) => ({ color, polylines: [contour] })));
    const nonZero = fill([{ color, fillRule: 'nonzero', polylines: contours }]);
    expect(row(independent, 3)).toEqual([[0, 10]]);
    expect(row(nonZero, 3)).toEqual([[0, 10]]);
  });
});
