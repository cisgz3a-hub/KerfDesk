import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene/scene-object';
import { provenContourGroups } from './proven-contour-groups';

function rectangle(x: number, y: number, size: number): CurveSubpath {
  return {
    start: { x, y },
    closed: true,
    segments: [
      { kind: 'line', to: { x: x + size, y } },
      { kind: 'line', to: { x: x + size, y: y + size } },
      { kind: 'line', to: { x, y: y + size } },
    ],
  };
}

describe('proven contour grouping', () => {
  it('keeps the compound when bounded analysis cannot prove its nesting', () => {
    const points = Array.from({ length: 800 }, (_, index) => ({
      x: 20 * Math.cos((index * 2 * Math.PI) / 800),
      y: 20 * Math.sin((index * 2 * Math.PI) / 800),
    }));
    const ring: CurveSubpath = {
      start: points[0]!,
      closed: true,
      segments: points.slice(1).map((to) => ({ kind: 'line', to })),
    };
    expect(provenContourGroups([ring, rectangle(-1, -1, 2)])).toBeNull();
  });
  it('keeps proved nested and disjoint islands', () => {
    expect(
      provenContourGroups([
        rectangle(0, 0, 30),
        rectangle(5, 5, 20),
        rectangle(10, 10, 5),
        rectangle(40, 0, 4),
      ]),
    ).toEqual([
      { outer: 0, holes: [1] },
      { outer: 2, holes: [] },
      { outer: 3, holes: [] },
    ]);
  });
  it.each([
    [5, 5],
    [0, 0],
    [10, 0],
  ])('keeps crossing, duplicate or touching compounds intact (%s,%s)', (x, y) => {
    expect(provenContourGroups([rectangle(0, 0, 10), rectangle(x, y, 10)])).toBeNull();
  });
  it('does not infer a nested region from a self-crossing boundary', () => {
    const bow: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 10, y: 10 } },
        { kind: 'line', to: { x: 0, y: 10 } },
        { kind: 'line', to: { x: 10, y: 0 } },
      ],
    };
    expect(provenContourGroups([bow, rectangle(1, 1, 1)])).toBeNull();
  });
  it('still proves separated curved nesting', () => {
    const circle = (radius: number): CurveSubpath => ({
      start: { x: radius, y: 0 },
      closed: true,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: radius,
          radiusY: radius,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: -radius, y: 0 },
        },
        {
          kind: 'elliptical-arc',
          radiusX: radius,
          radiusY: radius,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: radius, y: 0 },
        },
      ],
    });
    expect(provenContourGroups([circle(10), circle(5)])).toEqual([{ outer: 0, holes: [1] }]);
  });
});
