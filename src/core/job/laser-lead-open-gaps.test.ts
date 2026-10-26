import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath } from '../scene';
import { openOutlines } from './laser-lead-open-gaps';

const curve = (...points: Array<readonly [number, number]>) => ({
  curve: polylineToCurveSubpath({ points: points.map(([x, y]) => ({ x, y })), closed: false }),
  signature: '',
});

function arc(degrees: number, r = 10): Array<readonly [number, number]> {
  const steps = Math.ceil(degrees / 5);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (((index / steps) * degrees) / 180) * Math.PI;
    return [r * Math.cos(angle), r * Math.sin(angle)] as const;
  });
}

const gaps = (outlines: ReadonlyArray<{ readonly gapMm: number }>) =>
  outlines.map((outline) => Number(outline.gapMm.toFixed(3)));

describe('openOutlines (ADR-626 Amendment 10)', () => {
  it('reads a path whose ends lie within a tenth of its length as an outline', () => {
    // 340 degrees: the ends are 3.5 mm apart on a 59 mm arc.
    expect(gaps(openOutlines([curve(...arc(340))], 0.5))).toEqual([3.473]);
    // 300 degrees: 10 mm apart on 52 mm, an arc rather than an outline.
    expect(openOutlines([curve(...arc(300))], 0.5)).toEqual([]);
  });

  it('chains paths whose ends meet, then reads the chain', () => {
    // Three sides of a square and most of the fourth, as separate lines.
    const square = [
      curve([0, 0], [40, 0]),
      curve([40, 0], [40, 40]),
      curve([40, 40], [0, 40]),
      curve([0, 40], [0, 1.5]),
    ];
    const outlines = openOutlines(square, 0.5);
    expect(gaps(outlines)).toEqual([1.5]);
    expect(outlines[0]?.index).toBe(0);
    expect(outlines[0]?.points).toHaveLength(5);
  });

  it('gives a chain that joining closes no gap', () => {
    const loop = [curve([0, 0], [40, 0], [40, 40]), curve([40, 40], [0, 40], [0, 0.3])];
    expect(gaps(openOutlines(loop, 0.5))).toEqual([0]);
  });

  it('reads no straight line, L or U as an outline', () => {
    const shapes = [
      curve([0, 0], [40, 0]),
      curve([0, 10], [20, 10], [40, 10]),
      curve([100, 0], [140, 0], [140, 40]),
      curve([200, 0], [240, 0], [240, 40], [200, 40]),
    ];
    expect(openOutlines(shapes, 0.5)).toEqual([]);
  });

  it('joins only paths with one signature', () => {
    // Joined, the two would be one outline 1 mm open.
    const first = curve([0, 0], [40, 0], [40, 40]);
    const second = { ...curve([40, 40], [0, 40], [0, 1]), signature: 'other' };
    expect(openOutlines([first, second], 0.5)).toEqual([]);
  });
});
