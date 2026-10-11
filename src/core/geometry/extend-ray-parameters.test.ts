import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type EllipticalArcPathSegment,
  type Transform,
  type Vec2,
} from '../scene';
import { segmentRayParametricContacts } from './extend-ray';

type ArcCase = { readonly largeArc: boolean; readonly sweep: boolean };
const cases: ArcCase[] = [
  { largeArc: false, sweep: false },
  { largeArc: false, sweep: true },
  { largeArc: true, sweep: false },
  { largeArc: true, sweep: true },
];
const p = (x: number, y: number): Vec2 => ({ x, y });

function fixture(options: ArcCase, radius = 10) {
  const reverse = options.sweep === options.largeArc;
  const from = reverse ? p(0, radius) : p(radius, 0);
  const segment: EllipticalArcPathSegment = {
    kind: 'elliptical-arc',
    radiusX: radius,
    radiusY: radius,
    rotationDeg: 0,
    ...options,
    to: reverse ? p(radius, 0) : p(0, radius),
  };
  const startAngle = reverse ? Math.PI / 2 : 0;
  const delta = (options.sweep ? 1 : -1) * (options.largeArc ? 1.5 : 0.5) * Math.PI;
  return { from, segment, startAngle, delta };
}

function radialContacts(
  arc: ReturnType<typeof fixture>,
  angle: number,
  transform: Transform = IDENTITY_TRANSFORM,
) {
  const origin = applyTransform(p(0, 0), transform);
  const ahead = applyTransform(p(Math.cos(angle), Math.sin(angle)), transform);
  const dx = ahead.x - origin.x;
  const dy = ahead.y - origin.y;
  const length = Math.hypot(dx, dy);
  return segmentRayParametricContacts(
    origin,
    p(dx / length, dy / length),
    arc.from,
    arc.segment,
    transform,
  );
}

describe.each(cases)('canonical arc parameters for largeArc=$largeArc, sweep=$sweep', (options) => {
  it('clamps physical endpoint contacts to the correct endpoint, including just outside the span', () => {
    const arc = fixture(options);
    const angleNoise = Math.sign(arc.delta) * 5e-9; // 5e-8 mm on a radius-10 circle.
    for (const [angle, expected] of [
      [arc.startAngle, 0],
      [arc.startAngle - angleNoise, 0],
      [arc.startAngle + arc.delta, 1],
      [arc.startAngle + arc.delta + angleNoise, 1],
    ]) {
      const hits = radialContacts(arc, angle!);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.parameter).toBe(expected);
      expect(hits[0]?.distance).toBeCloseTo(10, 7);
    }
  });

  it('returns the original sweep parameter for transformed interior contacts', () => {
    const arc = fixture(options);
    const transform: Transform = {
      ...IDENTITY_TRANSFORM,
      x: 21,
      y: -13,
      scaleX: 3,
      scaleY: 0.4,
      mirrorX: true,
      rotationDeg: 37,
    };
    for (const t of [0.2, 0.5, 0.8]) {
      const hits = radialContacts(arc, arc.startAngle + arc.delta * t, transform);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.parameter).toBeCloseTo(t, 9);
      expect(hits[0]?.overlap).toBe(false);
    }
  });

  it('does not assign a parameter to a large-scale contact outside either finite endpoint', () => {
    const arc = fixture(options, 1e6);
    const transform = { ...IDENTITY_TRANSFORM, scaleX: 1e5, scaleY: 1e5 };
    const angleGap = Math.sign(arc.delta) * 5e-11; // Five world millimetres.
    expect(radialContacts(arc, arc.startAngle - angleGap, transform)).toEqual([]);
    expect(radialContacts(arc, arc.startAngle + arc.delta + angleGap, transform)).toEqual([]);
  });
});

describe('canonical line and cubic parameters', () => {
  it('returns the finite line parameter and leaves non-unique overlaps unparameterized', () => {
    expect(
      segmentRayParametricContacts(
        p(10, 0),
        p(1, 0),
        p(20, -5),
        { kind: 'line', to: p(20, 15) },
        IDENTITY_TRANSFORM,
      ),
    ).toEqual([{ distance: 10, overlap: false, parameter: 0.25 }]);
    expect(
      segmentRayParametricContacts(
        p(10, 0),
        p(1, 0),
        p(20, 0),
        { kind: 'line', to: p(30, 0) },
        IDENTITY_TRANSFORM,
      ),
    ).toEqual([{ distance: 10, overlap: true, parameter: null }]);
  });

  it('retains the cubic tangent parameter instead of its chord fraction', () => {
    const hits = segmentRayParametricContacts(
      p(0, 0),
      p(1, 0),
      p(0, 0.09),
      {
        kind: 'cubic',
        control1: p(10 / 3, -0.11),
        control2: p(20 / 3, 0.09 - 0.4 + 1 / 3),
        to: p(10, 0.49),
      },
      IDENTITY_TRANSFORM,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.parameter).toBeCloseTo(0.3, 9);
    expect(hits[0]?.distance).toBeCloseTo(3, 9);
  });
});
