// Round corners and round caps of the two offset tools are stored as chords.
// Clipper's default arc tolerance is 1/500 of the offset distance, so a big
// offset drifted far off its circle (0.1 mm at 50 mm, 2 mm at 1 m) while the
// rest of the app holds curves to DEFAULT_MACHINE_CURVE_TOLERANCE_MM (E-6).
// The chords must stay within that tolerance at any distance, and small offsets
// must stay as fine as they always were.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import { offsetShapes, type OffsetShapesOptions } from './offset-shapes';
import { offsetVectorObjects } from './vector-path-booleans';

const IDS = { outward: 'out', inward: 'in' };
// Clipper stores the result on a 1 µm grid (VECTOR_PATH_PRECISION_DECIMALS).
const GRID_MM = 0.001;
// Clipper's own default chord error is a fifth of a percent of the distance.
const FINE_RATIO = 0.002;
const MIN_ARC_CHORDS = 8;

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  };
}

function art(polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art',
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
  };
}

const SQUARE = art([rect(0, 0, 100, 100)]);
// A 200 mm plate with a 40 mm window: an inward offset grows the window with
// round corners, because the window's corners are concave for the material.
const FRAME = art([rect(0, 0, 200, 200), rect(80, 80, 120, 120)]);
const LINE = art([
  {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  },
]);

type Arc = {
  readonly center: Vec2;
  readonly radiusMm: number;
  /** True for the points that belong to this arc and not to a straight edge. */
  readonly owns: (point: Vec2) => boolean;
};

// The widest gap between a chord of the arc and the true circle: the chord's
// midpoint sits that far inside the radius.
function arcChordError(
  object: ImportedSvg | null,
  arc: Arc,
): { readonly worstMm: number; readonly chords: number } {
  if (object === null) throw new Error('the offset produced no object');
  let worstMm = 0;
  let chords = 0;
  for (const polyline of object.paths.flatMap((path) => path.polylines)) {
    for (let index = 1; index < polyline.points.length; index += 1) {
      const a = polyline.points[index - 1]!;
      const b = polyline.points[index]!;
      if (!arc.owns(a) || !arc.owns(b)) continue;
      chords += 1;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const gap = arc.radiusMm - Math.hypot(midpoint.x - arc.center.x, midpoint.y - arc.center.y);
      worstMm = Math.max(worstMm, gap);
    }
  }
  return { worstMm, chords };
}

function options(patch: Partial<OffsetShapesOptions>): OffsetShapesOptions {
  return {
    distanceMm: 1,
    direction: 'outward',
    cornerStyle: 'round',
    outerShapesOnly: false,
    ...patch,
  };
}

function shapesResult(
  source: ImportedSvg,
  patch: Partial<OffsetShapesOptions>,
): { readonly outward: ImportedSvg | null; readonly inward: ImportedSvg | null } {
  const result = offsetShapes([source], options(patch), IDS);
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}

function quickOffset(source: ImportedSvg, deltaMm: number): ImportedSvg {
  const result = offsetVectorObjects([source], deltaMm, 'quick');
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}

// The top-right corner of SQUARE: the outward arc runs through the quadrant
// beyond it, from (100 + d, 100) round to (100, 100 + d).
function squareCorner(distanceMm: number): Arc {
  return {
    center: { x: 100, y: 100 },
    radiusMm: distanceMm,
    owns: (point) => point.x >= 100 && point.y >= 100,
  };
}

// The window's bottom-right corner: the inward offset sweeps the quadrant
// beyond it, from (120 + d, 120) round to (120, 120 + d).
function windowCorner(distanceMm: number): Arc {
  return {
    center: { x: 120, y: 120 },
    radiusMm: distanceMm,
    owns: (point) => point.x >= 120 && point.y >= 120,
  };
}

describe('offset round corners stay within the machine curve tolerance', () => {
  it.each([0.5, 1, 5, 25, 50, 200])('Offset Shapes outward, %s mm', (distanceMm) => {
    const { outward } = shapesResult(SQUARE, { distanceMm });
    const { worstMm, chords } = arcChordError(outward, squareCorner(distanceMm));
    expect(chords).toBeGreaterThanOrEqual(MIN_ARC_CHORDS);
    expect(worstMm).toBeLessThanOrEqual(DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  });

  it.each([0.5, 1, 5, 25, 50, 200])('the quick offset outward, %s mm', (distanceMm) => {
    const { worstMm, chords } = arcChordError(
      quickOffset(SQUARE, distanceMm),
      squareCorner(distanceMm),
    );
    expect(chords).toBeGreaterThanOrEqual(MIN_ARC_CHORDS);
    expect(worstMm).toBeLessThanOrEqual(DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  });

  it('Offset Shapes inward rounds the corners it moves away from just as closely', () => {
    const { inward } = shapesResult(FRAME, { distanceMm: 25, direction: 'inward' });
    const { worstMm, chords } = arcChordError(inward, windowCorner(25));
    expect(chords).toBeGreaterThanOrEqual(MIN_ARC_CHORDS);
    expect(worstMm).toBeLessThanOrEqual(DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  });

  it('the quick offset inward rounds the window corners just as closely', () => {
    const { worstMm, chords } = arcChordError(quickOffset(FRAME, -25), windowCorner(25));
    expect(chords).toBeGreaterThanOrEqual(MIN_ARC_CHORDS);
    expect(worstMm).toBeLessThanOrEqual(DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  });

  it('round end caps around an open line stay within the tolerance', () => {
    const { outward } = shapesResult(LINE, { distanceMm: 25 });
    const cap: Arc = {
      center: { x: 100, y: 0 },
      radiusMm: 25,
      owns: (point) => point.x >= 100,
    };
    const { worstMm, chords } = arcChordError(outward, cap);
    expect(chords).toBeGreaterThanOrEqual(MIN_ARC_CHORDS);
    expect(worstMm).toBeLessThanOrEqual(DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  });

  it.each([0.5, 1, 5])('a small %s mm offset keeps its fine chords, not the coarse ones', (mm) => {
    const shapes = arcChordError(
      shapesResult(SQUARE, { distanceMm: mm }).outward,
      squareCorner(mm),
    );
    const quick = arcChordError(quickOffset(SQUARE, mm), squareCorner(mm));
    // A flat 0.025 mm chord error would cut a 1 mm corner into 4 chords, not 13.
    expect(shapes.worstMm).toBeLessThanOrEqual(FINE_RATIO * mm + GRID_MM);
    expect(quick.worstMm).toBeLessThanOrEqual(FINE_RATIO * mm + GRID_MM);
  });
});
