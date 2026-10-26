import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath } from '../scene';
import { runTraceSteps } from '../trace/trace-steps';
import { compilationPolylines, compilationPolylinesSteps } from './compilation-polylines';

describe('compilationPolylinesSteps', () => {
  it('flattens curve by curve exactly as the whole path does', () => {
    const circle = (x: number, r: number) => {
      const k = 0.5523 * r;
      return {
        start: { x: x + r, y: 0 },
        segments: [
          {
            kind: 'cubic' as const,
            control1: { x: x + r, y: k },
            control2: { x: x + k, y: r },
            to: { x, y: r },
          },
          {
            kind: 'cubic' as const,
            control1: { x: x - k, y: r },
            control2: { x: x - r, y: k },
            to: { x: x - r, y: 0 },
          },
          { kind: 'line' as const, to: { x: x + r, y: 0 } },
        ],
        closed: true,
      };
    };
    const path: ColoredPath = {
      color: '#000000',
      polylines: [],
      curves: [circle(0, 3), circle(10, 40), circle(-20, 0.5)],
    };
    const placement = { ...IDENTITY_TRANSFORM, scaleX: 0.08, scaleY: -0.05 };

    expect(runTraceSteps(compilationPolylinesSteps(path, placement))).toEqual(
      compilationPolylines(path, placement),
    );
    const noCurves: ColoredPath = {
      color: '#000000',
      polylines: compilationPolylines(path, placement),
    };
    expect(runTraceSteps(compilationPolylinesSteps(noCurves, placement))).toBe(noCurves.polylines);
  });
});

describe('compilationPolylines', () => {
  it('keeps canonical geometry above the worker-routing threshold', () => {
    const segmentCount = 100_001;
    const path: ColoredPath = {
      color: '#000000',
      // Deliberately wrong compatibility geometry: output must never fall back
      // to this view merely because the canonical path is large.
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: -999, y: -999 },
          ],
        },
      ],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: Array.from({ length: segmentCount }, (_, index) => ({
            kind: 'line' as const,
            to: { x: index + 1, y: 0 },
          })),
          closed: false,
        },
      ],
    };

    const compiled = compilationPolylines(path, IDENTITY_TRANSFORM);

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.points).toHaveLength(segmentCount + 1);
    expect(compiled[0]?.points.at(-1)).toEqual({ x: segmentCount, y: 0 });
  });
});
