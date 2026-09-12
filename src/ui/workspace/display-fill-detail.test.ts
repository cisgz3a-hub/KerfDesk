import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline } from '../../core/scene';
import { countPolylineSegments } from './draw-complexity';
import {
  buildDisplayPolylines,
  buildFillDisplayPolylines,
  createDisplayPolylineCache,
} from './display-polylines';

const hole: Polyline = {
  closed: true,
  points: [
    { x: 4, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 6 },
    { x: 4, y: 6 },
    { x: 4, y: 4 },
  ],
};

function area(polyline: Polyline): number {
  let twice = 0;
  for (let i = 0; i < polyline.points.length; i++) {
    const a = polyline.points[i]!;
    const b = polyline.points[(i + 1) % polyline.points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

describe('filled display detail', () => {
  it('preserves a real four-corner hole when the default display stride would collapse it', () => {
    const dense: Polyline = {
      closed: true,
      points: Array.from({ length: 120_001 }, (_, i) => ({
        x: 5 + 10 * Math.cos((i * Math.PI) / 60_000),
        y: 5 + 10 * Math.sin((i * Math.PI) / 60_000),
      })),
    };
    const source = [dense, hole];
    expect(area(buildDisplayPolylines(source).polylines[1]!)).toBe(0);
    const display = buildFillDisplayPolylines(source);
    expect(display.polylines).toBe(source);
    expect(area(display.polylines[1]!)).toBe(4);
    expect(display.isSimplified).toBe(false);
  });

  it('keeps every narrow tooth and small loop regardless of their phase in the vertex budget', () => {
    const tooth: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 1 },
        { x: 5.01, y: 1 },
        { x: 5.01, y: 20 },
        { x: 5, y: 20 },
        { x: 5, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    const source = Object.freeze([tooth, ...Array.from({ length: 1000 }, () => hole)]);
    const display = buildFillDisplayPolylines(source, 3);
    expect(display.polylines).toBe(source);
    expect(display.polylines[0]!.points).toBe(tooth.points);
    expect(display.polylines.filter((polyline) => area(polyline) === 4)).toHaveLength(1000);
  });

  it('still bounds open short strokes while retaining closed contours and each paint-group order', () => {
    const open = Array.from(
      { length: 6000 },
      (_, i): Polyline => ({
        closed: false,
        points: [
          { x: i, y: 0 },
          { x: i, y: 1 },
        ],
      }),
    );
    const source = [open[0]!, hole, ...open.slice(1), hole];
    const display = buildFillDisplayPolylines(source, 100);
    expect(display.isSimplified).toBe(true);
    expect(display.polylines.filter((line) => line.closed)).toEqual([hole, hole]);
    const strokes = display.polylines.filter((line) => !line.closed);
    expect(countPolylineSegments(strokes)).toBeLessThanOrEqual(100);
    expect(strokes[0]).toBe(open[0]);
    expect(strokes[1]).toBe(open[60]);
  });

  it('caches canonical line geometry across zoom and invalidates it on geometry replacement', () => {
    const curves = Object.freeze([
      {
        start: hole.points[0]!,
        closed: true,
        segments: hole.points.slice(1).map((to) => ({ kind: 'line' as const, to })),
      },
    ]);
    const path: ColoredPath = { color: '#000000', curves, polylines: [] };
    const cache = createDisplayPolylineCache();
    const before = structuredClone(path);
    const first = cache.getFillPath(path, 0.25, 1);
    expect(first.polylines[0]!.points).toEqual(hole.points);
    expect(cache.getFillPath(path, 0.0001, 1)).toBe(first);
    const edited = { ...path, curves: [{ ...curves[0]!, start: { x: 3, y: 3 } }] };
    const next = cache.getFillPath(edited, 0.0001, 1);
    expect(next).not.toBe(first);
    expect(next.polylines[0]!.points[0]).toEqual({ x: 3, y: 3 });
    expect(path).toEqual(before);
  });

  it('continues retessellating curved fills as the screen tolerance changes', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: true,
          segments: [
            {
              kind: 'cubic',
              control1: { x: 0, y: 100 },
              control2: { x: 100, y: 100 },
              to: { x: 100, y: 0 },
            },
          ],
        },
      ],
    };
    const cache = createDisplayPolylineCache();
    const coarse = cache.getFillPath(path, 1);
    const fine = cache.getFillPath(path, 0.01);
    expect(fine.segmentCount).toBeGreaterThan(coarse.segmentCount);
    expect(cache.getFillPath(path, 0.01)).toBe(fine);
  });

  it('invalidates a curve-budget fallback when its compatibility polylines change', () => {
    const first: ColoredPath = {
      color: '#000000',
      polylines: [hole],
      curves: [
        {
          start: { x: 1e9, y: 0 },
          closed: true,
          segments: [
            {
              kind: 'elliptical-arc',
              radiusX: 1e9,
              radiusY: 1e9,
              rotationDeg: 0,
              largeArc: false,
              sweep: true,
              to: { x: -1e9, y: 0 },
            },
          ],
        },
      ],
    };
    const second: ColoredPath = {
      ...first,
      polylines: [{ ...hole, points: hole.points.map((point) => ({ ...point, x: point.x + 25 })) }],
    };
    const cache = createDisplayPolylineCache();
    expect(cache.getFillPath(first, 0.001).polylines).toBe(first.polylines);
    expect(cache.getFillPath(second, 0.001).polylines).toBe(second.polylines);
  });
});
