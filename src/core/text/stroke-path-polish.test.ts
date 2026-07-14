import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { polishStrokePath } from './stroke-path-polish';

const FIT_TOLERANCE_UNITS = 2.5;

function linePath(points: ReadonlyArray<Vec2>): CurveSubpath {
  const start = points[0] ?? { x: 0, y: 0 };
  return {
    start,
    closed: false,
    segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
  };
}

describe('polishStrokePath', () => {
  it('fits a faceted bowl into fewer smooth cubic segments', () => {
    const points = Array.from({ length: 25 }, (_, index) => {
      const angle = (index / 24) * Math.PI;
      const noise = index % 2 === 0 ? 0.6 : -0.6;
      return {
        x: (50 + noise) * Math.cos(angle),
        y: (50 + noise) * Math.sin(angle),
      };
    });
    const original = linePath(points);
    const polished = polishStrokePath(original, {
      fitToleranceUnits: FIT_TOLERANCE_UNITS,
    });

    expect(polished.closed).toBe(false);
    expect(polished.start).toEqual(original.start);
    expect(polished.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(polished.segments.length).toBeLessThan(original.segments.length);
    expect(polished.segments.at(-1)?.to).toEqual(original.segments.at(-1)?.to);
  });

  it('keeps a genuine sharp corner as an exact cubic boundary', () => {
    const corner = { x: 20, y: 0 };
    const original = linePath([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
      corner,
      { x: 20, y: 5 },
      { x: 20, y: 10 },
      { x: 20, y: 15 },
      { x: 20, y: 20 },
    ]);
    const polished = polishStrokePath(original, {
      fitToleranceUnits: FIT_TOLERANCE_UNITS,
    });

    expect(polished.segments.some((segment) => segment.to === corner)).toBe(true);
  });

  it('leaves already-authored cubics and underspecified short strokes unchanged', () => {
    const cubic: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 1, y: 0 },
          control2: { x: 2, y: 1 },
          to: { x: 3, y: 1 },
        },
      ],
    };
    const short = linePath([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]);

    expect(polishStrokePath(cubic, { fitToleranceUnits: FIT_TOLERANCE_UNITS })).toBe(cubic);
    expect(polishStrokePath(short, { fitToleranceUnits: FIT_TOLERANCE_UNITS })).toBe(short);
  });
});
