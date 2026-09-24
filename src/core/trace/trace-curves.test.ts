import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath, type ColoredPath, type CurveSubpath, type Vec2 } from '../scene';
import { sampleCubics, type CubicBezier } from './fit-cubics';
import { fittedTraceRing, withCanonicalTraceCurves } from './trace-curves';

const LOOP: ReadonlyArray<CubicBezier> = [
  { p0: { x: 10, y: 10 }, p1: { x: 40, y: -10 }, p2: { x: 60, y: 30 }, p3: { x: 30, y: 40 } },
  { p0: { x: 30, y: 40 }, p1: { x: 0, y: 50 }, p2: { x: -10, y: 20 }, p3: { x: 10, y: 10 } },
];

function curveOf(cubics: ReadonlyArray<CubicBezier>): CurveSubpath {
  return {
    start: (cubics[0] as CubicBezier).p0,
    closed: true,
    segments: cubics.map((cubic) => ({
      kind: 'cubic',
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  };
}

function withRing(points: Vec2[]): ColoredPath {
  return { color: '#000000', polylines: [{ points, closed: true }] };
}

describe('canonical trace curves', () => {
  it('samples fitted cubics as an explicit ring and keeps them as its curve', () => {
    const ring = fittedTraceRing(LOOP);
    const samples = sampleCubics(LOOP, true);
    expect(ring).toEqual([...samples, samples[0]]);
    const [path] = withCanonicalTraceCurves([withRing(ring)]);
    expect(path?.curves).toEqual([curveOf(LOOP)]);
  });

  it('falls back to straight segments over samples a later stage copied', () => {
    const copy = [...fittedTraceRing(LOOP)];
    const [path] = withCanonicalTraceCurves([withRing(copy)]);
    expect(path?.curves).toEqual([polylineToCurveSubpath({ points: copy, closed: true })]);
  });

  it('keeps curves a path already carries', () => {
    const curves = [curveOf(LOOP)];
    const path: ColoredPath = { ...withRing(fittedTraceRing(LOOP).slice()), curves };
    expect(withCanonicalTraceCurves([path])[0]?.curves).toBe(curves);
  });
});
