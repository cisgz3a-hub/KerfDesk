import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { fairToolpathPolylines } from './fair-toolpath-polylines';

const OPTIONS = { mmPerPx: 0.1, minSegmentMm: 0.4, maxDeviationMm: 0.05, cornerAngleDeg: 60 };

describe('fairing with contact pins', () => {
  it('keeps a protected ring endpoint distinct from a nearby closing duplicate', () => {
    const contact = { x: 0, y: 5e-7 };
    const ring: Polyline = {
      closed: true,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, contact],
    };
    const result = fairToolpathPolylines([ring], { ...OPTIONS, pinnedPoints: new Set([contact]) });
    expect(result[0]?.points).toContainEqual(contact);
    expect(result[0]?.points[0]).toEqual(result[0]?.points.at(-1));
    expect(ring.points.at(-1)).toBe(contact);
  });

  it('keeps two contact pins closer than the corner-suppression window', () => {
    const points = Array.from({ length: 21 }, (_, x) => ({ x, y: x % 2 === 0 ? 0.3 : -0.3 }));
    const first = points[9]!,
      second = points[10]!;
    const result = fairToolpathPolylines([{ closed: false, points }], {
      ...OPTIONS,
      pinnedPoints: new Set([first, second]),
    });
    expect(result[0]?.points).toContainEqual(first);
    expect(result[0]?.points).toContainEqual(second);
    expect(result[0]?.points[0]).toEqual(points[0]);
    expect(result[0]?.points.at(-1)).toEqual(points.at(-1));
  });
});
