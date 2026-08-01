import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { polylineDeviationBounds } from '../../__fixtures__/polyline-deviation-bounds';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

const TRACE_COLOR = '#000000';
const MAX_DEVIATION_MM = 0.05;
const DEVIATION_ORACLE_ERROR_MM = 0.005;
const FLOAT_TOLERANCE_MM = 1e-6;
const HUGE_FINITE_SCALE = 1e100;
const TINY_FINITE_SCALE = 1e-300;
const PROPERTY_RUNS = 100;
const PROPERTY_SEED = 410_001;
const MIN_PROPERTY_POINT_COUNT = 5;
const MAX_PROPERTY_POINT_COUNT = 20;
const MIN_SCALE_EXPONENT = -32;
const MAX_SCALE_EXPONENT = 12;
const SCALE_BASE = 2;
const SCALE_EXPONENT_DIVISOR = 4;
const MIN_ROTATION_DEG = -180;
const MAX_ROTATION_DEG = 180;
const OPEN_CHAIN_RISE = 0.25;
const OPEN_CHAIN_JITTER_STEP = 0.01;
const MIN_JITTER_STEP = -10;
const MAX_JITTER_STEP = 10;
const MIN_RING_POINT_COUNT = 8;
const MAX_RING_POINT_COUNT = 20;
const RING_RADIUS = 10;
const RING_JITTER_STEP = 0.02;
const FULL_TURN_RADIANS = Math.PI * 2;
const HUGE_SCALE_PHYSICAL_SOURCE: Polyline = {
  closed: false,
  points: [
    { x: -0.15, y: 0 },
    { x: -0.05, y: 0.1 },
    { x: 0.05, y: 0.1 },
    { x: 0.15, y: 0 },
  ],
};
const ANISOTROPIC_PLACEMENT: Transform = {
  x: 12,
  y: -4,
  scaleX: 1,
  scaleY: 10,
  rotationDeg: 37,
  mirrorX: true,
  mirrorY: false,
};
const WELD_PLACEMENT: Transform = {
  ...IDENTITY_TRANSFORM,
  scaleX: 0.4,
};
const ANISOTROPIC_DEVIATION_SOURCE: Polyline = {
  closed: false,
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.01 },
    { x: 1, y: -0.01 },
    { x: 1.5, y: 0.01 },
    { x: 2, y: 0 },
  ],
};
const HORIZONTAL_WELD_CHAINS: ReadonlyArray<Polyline> = [
  {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  },
  {
    closed: false,
    points: [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  },
];
const VERTICAL_WELD_CHAINS: ReadonlyArray<Polyline> = [
  {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
  },
  {
    closed: false,
    points: [
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ],
  },
];
const POSITIVE_SCALE_ARBITRARY = fc
  .integer({ min: MIN_SCALE_EXPONENT, max: MAX_SCALE_EXPONENT })
  .map((exponent) => SCALE_BASE ** (exponent / SCALE_EXPONENT_DIVISOR));
const PLACEMENT_ARBITRARY: fc.Arbitrary<Transform> = fc
  .tuple(
    POSITIVE_SCALE_ARBITRARY,
    POSITIVE_SCALE_ARBITRARY,
    fc.integer({ min: MIN_ROTATION_DEG, max: MAX_ROTATION_DEG }),
    fc.boolean(),
    fc.boolean(),
  )
  .filter(([scaleX, scaleY]) => scaleX !== scaleY)
  .map(([scaleX, scaleY, rotationDeg, mirrorX, mirrorY]) => ({
    ...IDENTITY_TRANSFORM,
    scaleX,
    scaleY,
    rotationDeg,
    mirrorX,
    mirrorY,
  }));
const OPEN_POLYLINE_ARBITRARY: fc.Arbitrary<Polyline> = fc
  .array(fc.integer({ min: MIN_JITTER_STEP, max: MAX_JITTER_STEP }), {
    minLength: MIN_PROPERTY_POINT_COUNT,
    maxLength: MAX_PROPERTY_POINT_COUNT,
  })
  .map((jitters) => ({
    closed: false,
    points: jitters.map((jitter, index) => ({
      x: index,
      y: index * OPEN_CHAIN_RISE + jitter * OPEN_CHAIN_JITTER_STEP,
    })),
  }));
const CLOSED_POLYLINE_ARBITRARY: fc.Arbitrary<Polyline> = fc
  .integer({ min: MIN_RING_POINT_COUNT, max: MAX_RING_POINT_COUNT })
  .chain((pointCount) =>
    fc
      .array(fc.integer({ min: MIN_JITTER_STEP, max: MAX_JITTER_STEP }), {
        minLength: pointCount,
        maxLength: pointCount,
      })
      .map((jitters): Polyline => {
        const points = jitters.map((jitter, index) => {
          const angle = (index / pointCount) * FULL_TURN_RADIANS;
          const radius = RING_RADIUS + jitter * RING_JITTER_STEP;
          return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        });
        const first = points[0];
        if (first === undefined) throw new Error('expected a generated ring point');
        return { closed: true, points: [...points, { ...first }] };
      }),
  );
const POLYLINE_ARBITRARY = fc.oneof(OPEN_POLYLINE_ARBITRARY, CLOSED_POLYLINE_ARBITRARY);

function pathWith(polylines: ReadonlyArray<Polyline>): ColoredPath {
  return { color: TRACE_COLOR, polylines };
}

function onlyPolyline(paths: ReadonlyArray<ColoredPath>): Polyline {
  const polyline = paths[0]?.polylines[0];
  if (polyline === undefined) throw new Error('expected one faired polyline');
  return polyline;
}

function worldPoints(polyline: Polyline, transform: Transform): Vec2[] {
  return polyline.points.map((point) => applyTransform(point, transform));
}

function localPolylineAtScale(polyline: Polyline, scale: number): Polyline {
  return {
    ...polyline,
    points: polyline.points.map((point) => ({
      x: point.x / scale,
      y: point.y / scale,
    })),
  };
}

describe('fairTracedPathsForCnc', () => {
  it('keeps physical output finite and within the deviation bound across transforms (property)', () => {
    fc.assert(
      fc.property(PLACEMENT_ARBITRARY, POLYLINE_ARBITRARY, (placement, source) => {
        const faired = onlyPolyline(fairTracedPathsForCnc([pathWith([source])], placement));
        const fairedWorld = worldPoints(faired, placement);
        const sourceWorld = worldPoints(source, placement);
        const deviation = polylineDeviationBounds(
          fairedWorld,
          sourceWorld,
          DEVIATION_ORACLE_ERROR_MM,
        );

        expect(fairedWorld.length).toBeGreaterThan(1);
        expect(fairedWorld.length).toBeLessThanOrEqual(sourceWorld.length);
        expect(
          fairedWorld.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
        ).toBe(true);
        expect(Number.isFinite(deviation.upperBound)).toBe(true);
        expect(deviation.upperBound).toBeLessThanOrEqual(
          MAX_DEVIATION_MM + DEVIATION_ORACLE_ERROR_MM + FLOAT_TOLERANCE_MM,
        );
        expect(faired.closed).toBe(source.closed);
      }),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });

  it('caps physical displacement after anisotropic mirror and rotation', () => {
    const faired = onlyPolyline(
      fairTracedPathsForCnc([pathWith([ANISOTROPIC_DEVIATION_SOURCE])], ANISOTROPIC_PLACEMENT),
    );
    const deviation = polylineDeviationBounds(
      worldPoints(faired, ANISOTROPIC_PLACEMENT),
      worldPoints(ANISOTROPIC_DEVIATION_SOURCE, ANISOTROPIC_PLACEMENT),
      DEVIATION_ORACLE_ERROR_MM,
    );

    expect(deviation.lowerBound).toBeGreaterThan(0);
    expect(deviation.upperBound).toBeLessThanOrEqual(
      MAX_DEVIATION_MM + DEVIATION_ORACLE_ERROR_MM + FLOAT_TOLERANCE_MM,
    );
    expect(faired.closed).toBe(false);
    expect(
      fairTracedPathsForCnc([pathWith([ANISOTROPIC_DEVIATION_SOURCE])], ANISOTROPIC_PLACEMENT)[0]
        ?.curves?.[0],
    ).toMatchObject({
      closed: false,
    });
  });

  it('uses physical distance for anisotropic weld decisions', () => {
    expect(
      fairTracedPathsForCnc([pathWith(HORIZONTAL_WELD_CHAINS)], WELD_PLACEMENT)[0]?.polylines,
    ).toHaveLength(1);
    expect(
      fairTracedPathsForCnc([pathWith(VERTICAL_WELD_CHAINS)], WELD_PLACEMENT)[0]?.polylines,
    ).toHaveLength(2);
  });

  it('keeps geometry finite and rebuilds curves when placement scale is unusable', () => {
    const source: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const paths = fairTracedPathsForCnc([pathWith([source])], { ...IDENTITY_TRANSFORM, scaleX: 0 });

    expect(onlyPolyline(paths)).toEqual(source);
    expect(paths[0]?.curves?.[0]?.segments).toHaveLength(1);
  });

  it('keeps output finite when a tiny nonzero placement scale would underflow a product', () => {
    const source: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 3, y: 1 },
      ],
    };
    const faired = onlyPolyline(
      fairTracedPathsForCnc([pathWith([source])], {
        ...IDENTITY_TRANSFORM,
        scaleX: TINY_FINITE_SCALE,
        scaleY: TINY_FINITE_SCALE,
      }),
    );

    expect(
      faired.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    ).toBe(true);
  });

  it('keeps the deviation tolerance physical at a huge finite placement scale', () => {
    const placement: Transform = {
      ...IDENTITY_TRANSFORM,
      scaleX: HUGE_FINITE_SCALE,
      scaleY: HUGE_FINITE_SCALE,
    };
    const source = localPolylineAtScale(HUGE_SCALE_PHYSICAL_SOURCE, HUGE_FINITE_SCALE);
    const faired = onlyPolyline(fairTracedPathsForCnc([pathWith([source])], placement));
    const deviation = polylineDeviationBounds(
      worldPoints(faired, placement),
      worldPoints(source, placement),
      DEVIATION_ORACLE_ERROR_MM,
    );

    expect(deviation.upperBound).toBeLessThanOrEqual(
      MAX_DEVIATION_MM + DEVIATION_ORACLE_ERROR_MM + FLOAT_TOLERANCE_MM,
    );
    expect(faired.points.length).toBeLessThanOrEqual(source.points.length);
  });
});
