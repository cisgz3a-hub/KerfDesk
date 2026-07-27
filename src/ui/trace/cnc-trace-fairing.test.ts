import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { maximumPointDistanceToPolyline } from '../../__fixtures__/polyline-distance';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

const TRACE_COLOR = '#000000';
const MAX_DEVIATION_MM = 0.05;
const FLOAT_TOLERANCE_MM = 1e-6;
const TINY_FINITE_SCALE = 1e-300;
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

describe('fairTracedPathsForCnc', () => {
  it('caps physical displacement after anisotropic mirror and rotation', () => {
    const faired = onlyPolyline(
      fairTracedPathsForCnc([pathWith([ANISOTROPIC_DEVIATION_SOURCE])], ANISOTROPIC_PLACEMENT),
    );
    const maximumDeviation = maximumPointDistanceToPolyline(
      worldPoints(faired, ANISOTROPIC_PLACEMENT),
      worldPoints(ANISOTROPIC_DEVIATION_SOURCE, ANISOTROPIC_PLACEMENT),
    );

    expect(maximumDeviation).toBeGreaterThan(0);
    expect(maximumDeviation).toBeLessThanOrEqual(MAX_DEVIATION_MM + FLOAT_TOLERANCE_MM);
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
});
