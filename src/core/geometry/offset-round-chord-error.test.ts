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
import { createEllipse } from '../shapes/primitives';
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

// Rolling audit v7 L1-P3-2 (ADR-410 Amendment 3): a curved source was flattened
// at the full 0.025 mm before the offset, and each round corner centred on a
// chord vertex added its own chords on top, so an r 10 circle offset 50 mm sat
// 0.031 mm off the true r 60 circle. Both tools now flatten curved sources at
// OFFSET_SOURCE_CURVE_TOLERANCE_MM and give the round corners the rest.
describe('offsets of a curved source stay within the tolerance of the offset curve', () => {
  const RADIUS = 10;
  const disc = createEllipse({
    id: 'disc',
    color: '#000000',
    spec: { widthMm: 2 * RADIUS, heightMm: 2 * RADIUS },
  });
  const centre = {
    x: (disc.bounds.minX + disc.bounds.maxX) / 2,
    y: (disc.bounds.minY + disc.bounds.maxY) / 2,
  };

  // The farthest any point of the outline, edges sampled, lies off the circle.
  function circleDeviation(outline: ImportedSvg | null, radius: number): number {
    if (outline === null) throw new Error('the offset produced no object');
    let worst = 0;
    for (const polyline of outline.paths.flatMap((path) => path.polylines)) {
      const { points } = polyline;
      points.forEach((a, index) => {
        const b = points[(index + 1) % points.length]!;
        for (let step = 0; step <= 20; step += 1) {
          const t = step / 20;
          const x = a.x + (b.x - a.x) * t - centre.x;
          const y = a.y + (b.y - a.y) * t - centre.y;
          worst = Math.max(worst, Math.abs(Math.hypot(x, y) - radius));
        }
      });
    }
    return worst;
  }

  it.each([2, 12, 25, 50, 100])('outward %s mm', (mm) => {
    const shapes = offsetShapes(
      [disc],
      { distanceMm: mm, direction: 'outward', cornerStyle: 'round', outerShapesOnly: false },
      IDS,
    );
    if (shapes.kind !== 'ok') throw new Error(shapes.error.message);
    const quick = offsetVectorObjects([disc], mm, 'offset');
    if (quick.kind !== 'ok') throw new Error(quick.error.message);
    expect(circleDeviation(shapes.value.outward, RADIUS + mm)).toBeLessThanOrEqual(
      DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    );
    expect(circleDeviation(quick.value, RADIUS + mm)).toBeLessThanOrEqual(
      DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    );
  });

  it.each([2, 5, 9])('inward %s mm', (mm) => {
    const quick = offsetVectorObjects([disc], -mm, 'offset');
    if (quick.kind !== 'ok') throw new Error(quick.error.message);
    expect(circleDeviation(quick.value, RADIUS - mm)).toBeLessThanOrEqual(
      DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    );
  });
});
