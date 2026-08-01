import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { differenceClosedPolylinesChecked } from './polygon-difference';
import { signedAreaMm2 } from './polyline-orientation';

function rect(x: number, y: number, w: number, h: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

function totalArea(result: ReadonlyArray<Polyline>): number {
  return result.reduce((sum, polyline) => sum + Math.abs(signedAreaMm2(polyline.points)), 0);
}

describe('differenceClosedPolylinesChecked', () => {
  it('a fully covering clip leaves nothing — ok([]), not an error', () => {
    const result = differenceClosedPolylinesChecked([rect(0, 0, 10, 10)], [rect(-1, -1, 12, 12)]);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toEqual([]);
  });

  it('subtracting the left half leaves the right half', () => {
    const result = differenceClosedPolylinesChecked([rect(0, 0, 10, 10)], [rect(-1, -1, 6, 12)]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(totalArea(result.value)).toBeCloseTo(50, 6);
    for (const polyline of result.value) {
      for (const point of polyline.points) {
        expect(point.x).toBeGreaterThanOrEqual(5 - 1e-6);
      }
    }
  });

  it('an empty clip returns the subject unchanged', () => {
    const subject = [rect(0, 0, 10, 10)];
    const result = differenceClosedPolylinesChecked(subject, []);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe(subject);
  });

  it('a degenerate subject yields ok([])', () => {
    const line: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const result = differenceClosedPolylinesChecked([line], [rect(0, 0, 1, 1)]);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toEqual([]);
  });

  it('even-odd holes survive: an annulus minus its left half keeps the right band', () => {
    // Outer 10×10 with a centered 4×4 hole: even-odd annulus. Clipping away
    // x < 5 leaves the right band: area 5·10 − (hole overlap 2·4) = 42.
    const outer = rect(0, 0, 10, 10);
    const hole = rect(3, 3, 4, 4);
    const result = differenceClosedPolylinesChecked([outer, hole], [rect(-1, -1, 6, 12)]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(totalArea(result.value)).toBeCloseTo(42, 6);
  });
});
