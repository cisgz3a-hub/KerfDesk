import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type PathSegment } from '../scene';
import { segmentRayContacts } from './extend-ray';

const origin = { x: 10, y: 0 };
const direction = { x: 1, y: 0 };
function longBaselineContacts(y = 0) {
  // x(t)=10000t, y(t)=(t-.3)^2+y; its minimum is between sampled vertices.
  return segmentRayContacts(
    { x: 0, y: 0 },
    direction,
    { x: 0, y: 0.09 },
    {
      kind: 'cubic',
      control1: { x: 10 / 3, y: -0.11 },
      control2: { x: 20 / 3, y: 0.09 - 0.4 + 1 / 3 },
      to: { x: 10, y: 0.49 },
    },
    { ...IDENTITY_TRANSFORM, scaleX: 1000, y },
  ).sort((a, b) => a.distance - b.distance);
}
describe('analytic ray contacts', () => {
  it('returns one true cubic tangent contact along a long baseline', () => {
    const hits = longBaselineContacts();
    expect(hits).toHaveLength(1);
    expect(hits[0]?.distance).toBeCloseTo(3000, 6);
    expect(hits[0]?.overlap).toBe(false);
  });
  it('retains two genuine nearby roots without inventing a minimum contact', () => {
    const hits = longBaselineContacts(-1e-8);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.distance).toBeCloseTo(2999, 6);
    expect(hits[1]?.distance).toBeCloseTo(3001, 6);
  });
  it('rejects a cubic minimum strictly above the ray by 1e-8mm', () => {
    expect(longBaselineContacts(1e-8)).toEqual([]);
  });
  it('finds all three cubic crossings and never extrapolates the boundary', () => {
    // x(t)=20+10t, y(t)=100(t-.2)(t-.5)(t-.8).
    const segment: PathSegment = {
      kind: 'cubic',
      control1: { x: 20 + 10 / 3, y: 14 },
      control2: { x: 20 + 20 / 3, y: -14 },
      to: { x: 30, y: 8 },
    };
    const hits = segmentRayContacts(
      origin,
      direction,
      { x: 20, y: -8 },
      segment,
      IDENTITY_TRANSFORM,
    ).sort((a, b) => a.distance - b.distance);
    expect(hits).toHaveLength(3);
    [12, 15, 18].forEach((expected, i) => expect(hits[i]?.distance).toBeCloseTo(expected, 8));
  });
  it('does not invent contact for a cubic passing just above the ray', () => {
    const segment: PathSegment = {
      kind: 'cubic',
      control1: { x: 18, y: -0.999 },
      control2: { x: 22, y: -0.999 },
      to: { x: 25, y: 3.001 },
    };
    expect(
      segmentRayContacts(origin, direction, { x: 15, y: 3.001 }, segment, IDENTITY_TRANSFORM),
    ).toEqual([]);
  });
  it('finds a true tangency to an ellipse but rejects a nearby miss', () => {
    const segment: PathSegment = {
      kind: 'elliptical-arc',
      radiusX: 5,
      radiusY: 3,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: { x: 25, y: 3 },
    };
    const from = { x: 15, y: 3 };
    const hit = segmentRayContacts(origin, direction, from, segment, IDENTITY_TRANSFORM);
    expect(hit.some((h) => Math.abs(h.distance - 10) < 1e-6)).toBe(true);
    expect(
      segmentRayContacts({ x: 10, y: -0.001 }, direction, from, segment, IDENTITY_TRANSFORM),
    ).toEqual([]);
  });
  it('retains analytic ellipse contacts under mirrored nonuniform transforms', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 20,
      scaleX: 3,
      scaleY: 0.2,
      mirrorY: true,
      rotationDeg: 67,
    };
    const transformedOrigin = applyTransform(origin, transform);
    const ahead = applyTransform({ x: 11, y: 0 }, transform);
    const length = Math.hypot(ahead.x - transformedOrigin.x, ahead.y - transformedOrigin.y);
    const dir = {
      x: (ahead.x - transformedOrigin.x) / length,
      y: (ahead.y - transformedOrigin.y) / length,
    };
    const segment: PathSegment = {
      kind: 'elliptical-arc',
      radiusX: 5,
      radiusY: 5,
      rotationDeg: 0,
      largeArc: false,
      sweep: false,
      to: { x: 20, y: 5 },
    };
    const hits = segmentRayContacts(transformedOrigin, dir, { x: 20, y: -5 }, segment, transform);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.distance).toBeCloseTo(15, 8);
  });
  it('marks collinear cubics as overlap using the true projected extrema', () => {
    const segment: PathSegment = {
      kind: 'cubic',
      control1: { x: 22, y: 0 },
      control2: { x: 28, y: 0 },
      to: { x: 30, y: 0 },
    };
    expect(
      segmentRayContacts(origin, direction, { x: 20, y: 0 }, segment, IDENTITY_TRANSFORM),
    ).toEqual([{ distance: 10, overlap: true }]);
  });
});
