import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath, type CurveSubpath } from '../scene';
import { measureOutline, measureSegment } from './outline-measure';

const SQUARE = (x: number, size: number): CurveSubpath => ({
  start: { x, y: x },
  segments: [
    { kind: 'line', to: { x: x + size, y: x } },
    { kind: 'line', to: { x: x + size, y: x + size } },
    { kind: 'line', to: { x, y: x + size } },
  ],
  closed: true,
});

// A semicircle of radius 5 from (0,0) to (10,0), closed by its diameter.
const HALF_DISC: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 5,
      radiusY: 5,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: { x: 10, y: 0 },
    },
  ],
  closed: true,
};

const path = (...curves: CurveSubpath[]): ColoredPath => ({
  color: '#000000',
  curves,
  polylines: [],
});

describe('measureSegment', () => {
  it('reports a line length and angle after the object transform', () => {
    const transform = { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 };
    const measure = measureSegment(SQUARE(0, 10), 1, transform);
    expect(measure).toMatchObject({ kind: 'line', angleDeg: 90 });
    expect(measure?.lengthMm).toBeCloseTo(20, 9);
  });

  it('reports a circular arc centre, radius and length, and the implied closing line', () => {
    const transform = { ...IDENTITY_TRANSFORM, x: 100, scaleX: 2, scaleY: 2 };
    const arc = measureSegment(HALF_DISC, 0, transform);
    if (arc?.kind !== 'arc') throw new Error('expected an arc');
    expect(arc.radiusMm).toBeCloseTo(10, 9);
    expect(arc.center.x).toBeCloseTo(110, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
    expect(arc.lengthMm).toBeCloseTo(Math.PI * 10, 2);
    expect(measureSegment(HALF_DISC, 1, transform)?.lengthMm).toBeCloseTo(20, 9);
    const stretched = measureSegment(HALF_DISC, 0, { ...IDENTITY_TRANSFORM, scaleY: 3 });
    expect(stretched?.kind === 'arc' && stretched.radiusMm).toBeNull();
  });
});

describe('measureOutline', () => {
  it('subtracts holes, adds islands back and counts open paths without area', () => {
    const open: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 3, y: 4 } }],
      closed: false,
    };
    const outline = measureOutline(
      [path(SQUARE(0, 30), SQUARE(5, 20), SQUARE(10, 10)), path(open)],
      IDENTITY_TRANSFORM,
    );
    expect(outline.areaMm2).toBeCloseTo(900 - 400 + 100, 9);
    expect(outline.perimeterMm).toBeCloseTo(120 + 80 + 40 + 5, 9);
    expect(outline).toMatchObject({ closedContours: 3, openContours: 1 });
    expect(measureOutline([path(open)], IDENTITY_TRANSFORM).areaMm2).toBeNull();
  });
});
