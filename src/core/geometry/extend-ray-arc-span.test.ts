import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type PathSegment, type Vec2 } from '../scene';
import { segmentRayContacts } from './extend-ray';

const from = { x: 1e6, y: 0 };
const arc: PathSegment = {
  kind: 'elliptical-arc',
  radiusX: 1e6,
  radiusY: 1e6,
  rotationDeg: 0,
  largeArc: false,
  sweep: true,
  to: { x: 0, y: 1e6 },
};
const transform = { ...IDENTITY_TRANSFORM, scaleX: 1e5, scaleY: 1e5 };

describe('finite arc ray contacts use a world-distance endpoint tolerance', () => {
  it('keeps an unresolvably short rotated arc finite and retains its chord contacts', () => {
    const short = { ...arc, rotationDeg: 45, to: { x: 1e-10, y: 0 } };
    const start = { x: 0, y: 0 };
    // At this radius the computed sweep rounds to zero. The finite endpoints
    // are still 1e-5 mm apart in world space; they must not become a full circle.
    expect(
      segmentRayContacts({ x: 5e-6, y: 1e11 }, { x: 1, y: 0 }, start, short, transform),
    ).toEqual([]);
    for (const x of [0, 5e-6, 1e-5]) {
      const contacts = segmentRayContacts({ x, y: -1 }, { x: 0, y: 1 }, start, short, transform);
      expect(contacts).toEqual([{ distance: 1, overlap: false }]);
    }
  });

  it.each([
    [
      { x: -5, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: -5 },
      { x: 1, y: 0 },
    ],
    [
      { x: -0.00001, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: -0.00001 },
      { x: 1, y: 0 },
    ],
  ])('rejects a supporting-circle hit outside either physical endpoint', (origin, direction) => {
    expect(segmentRayContacts(origin, direction, from, arc, transform)).toEqual([]);
  });

  it.each([
    [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  ])('retains exact endpoint crossings at the same large scale', (origin, direction) => {
    const contacts = segmentRayContacts(origin, direction, from, arc, transform);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.distance).toBe(1e11);
  });

  it('retains a genuine contact just inside the finite arc', () => {
    const contacts = segmentRayContacts({ x: 5, y: 0 }, { x: 0, y: 1 }, from, arc, transform);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.distance).toBeCloseTo(1e11, 2);
  });

  it('rejects the same off-end hit for a reversed sweep and nonuniform mirrored ellipse', () => {
    const reversed = { ...arc, sweep: false, to: from };
    const mirrored = { ...transform, scaleX: 2e5, mirrorX: true };
    expect(segmentRayContacts({ x: 10, y: 0 }, { x: 0, y: 1 }, arc.to, reversed, mirrored)).toEqual(
      [],
    );
  });

  it.each([false, true])('handles a major arc with sweep=%s', (sweep) => {
    const start = sweep ? arc.to : from;
    const major = { ...arc, largeArc: true, sweep, to: sweep ? from : arc.to };
    for (const direction of [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]) {
      const contacts = segmentRayContacts({ x: 0, y: 0 }, direction, start, major, transform);
      expect(contacts).toHaveLength(1);
      expect(contacts[0]?.distance).toBe(1e11);
    }
    expect(segmentRayContacts({ x: 0, y: 5 }, { x: 1, y: 0 }, start, major, transform)).toEqual([]);
    expect(segmentRayContacts({ x: 5, y: 0 }, { x: 0, y: 1 }, start, major, transform)).toEqual([]);
    expect(
      segmentRayContacts(
        { x: 0, y: 0 },
        { x: Math.SQRT1_2, y: Math.SQRT1_2 },
        start,
        major,
        transform,
      ),
    ).toEqual([]);
  });

  it('retains genuine major-arc contacts under mirrored nonuniform transforms', () => {
    const placement = { ...transform, scaleX: 2e5, mirrorX: true, rotationDeg: 37, x: 21, y: -13 };
    const origin = applyTransform({ x: 0, y: 0 }, placement);
    const ahead = applyTransform({ x: -1, y: 0 }, placement);
    const length = Math.hypot(ahead.x - origin.x, ahead.y - origin.y);
    const direction = { x: (ahead.x - origin.x) / length, y: (ahead.y - origin.y) / length };
    const major = { ...arc, largeArc: true, sweep: false };
    const contacts = segmentRayContacts(origin, direction, from, major, placement);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.distance).toBeCloseTo(2e11, 3);
  });

  it('retains endpoint float noise within the world-millimetre tolerance', () => {
    const small = { ...arc, radiusX: 10, radiusY: 10, to: { x: 0, y: 10 } };
    const contacts = segmentRayContacts(
      { x: -5e-8, y: 0 },
      { x: 0, y: 1 },
      { x: 10, y: 0 },
      small,
      IDENTITY_TRANSFORM,
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.distance).toBeCloseTo(10, 6);
  });

  it.each([
    [
      { x: -5, y: 10 },
      { x: 1, y: 0 },
    ],
    [
      { x: 10, y: -5 },
      { x: 0, y: 1 },
    ],
  ] satisfies Array<[Vec2, Vec2]>)('retains ordinary endpoint tangencies', (origin, direction) => {
    const small = { ...arc, radiusX: 10, radiusY: 10, to: { x: 0, y: 10 } };
    const contacts = segmentRayContacts(
      origin,
      direction,
      { x: 10, y: 0 },
      small,
      IDENTITY_TRANSFORM,
    );
    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) expect(contact.distance).toBeCloseTo(5, 6);
  });
});
