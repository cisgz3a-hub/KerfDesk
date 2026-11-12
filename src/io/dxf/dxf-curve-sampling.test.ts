import { describe, expect, it } from 'vitest';
import { parseDxf } from './parse-dxf';
import {
  bulgeSegment,
  isFullEllipseSweep,
  normalizedSweep,
  sampleArc,
  sampleCircle,
  sampleEllipse,
} from './dxf-curve-sampling';

describe('bulgeSegment', () => {
  it('a quarter-circle bulge stays on the analytic circle', () => {
    // bulge = tan(sweep/4); 90° CCW from (0,0) to (10,0) arcs around (5,5).
    const bulge = Math.tan(Math.PI / 8);
    const points = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
    const radius = Math.hypot(5, 5);
    for (const point of points) {
      expect(Math.hypot(point.x - 5, point.y - 5)).toBeCloseTo(radius, 6);
    }
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  it('a negative bulge arcs to the other side of the chord', () => {
    const bulge = -Math.tan(Math.PI / 8);
    const points = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
    // CW quarter arc around (5,-5): every point on that circle, and the
    // whole arc sits ABOVE the chord (positive y) — the mirror of the
    // positive-bulge case.
    const radius = Math.hypot(5, 5);
    for (const point of points) {
      expect(Math.hypot(point.x - 5, point.y + 5)).toBeCloseTo(radius, 6);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
    // Sampled apex reaches the sagitta within the 0.05 mm chord tolerance.
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxY - (Math.abs(bulge) * 10) / 2)).toBeLessThanOrEqual(0.06);
  });

  it('zero bulge degenerates to the straight segment end', () => {
    expect(bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe('sampleArc / sampleCircle', () => {
  it('includes both endpoints and stays on radius', () => {
    const points = sampleArc({ x: 0, y: 0 }, 10, 0, Math.PI / 2);
    expect(points[0]?.x).toBeCloseTo(10, 9);
    expect(points[0]?.y).toBeCloseTo(0, 9);
    expect(points.at(-1)?.x).toBeCloseTo(0, 9);
    expect(points.at(-1)?.y).toBeCloseTo(10, 9);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
  });

  it('sampleCircle drops the seam duplicate', () => {
    const points = sampleCircle({ x: 0, y: 0 }, 5);
    expect(points[0]).not.toEqual(points.at(-1));
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(5, 9);
    }
  });
});

describe('sampleEllipse', () => {
  // Sampled extremes land within the documented 0.05 mm chord tolerance of
  // the analytic axes (a parameter-step sample rarely hits the exact apex).
  const EXTREME_TOLERANCE_MM = 0.06;

  it('a full ellipse hits the four analytic extremes', () => {
    const points = sampleEllipse({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.5, 0, Math.PI * 2);
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxX - 20)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
    expect(Math.abs(maxY - 10)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
  });

  it('honors a rotated major axis', () => {
    // Major axis along +Y: the ellipse is tall, not wide.
    const points = sampleEllipse({ x: 0, y: 0 }, { x: 0, y: 20 }, 0.5, 0, Math.PI * 2);
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxY - 20)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
    expect(Math.abs(maxX - 10)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
  });
});

describe('normalizedSweep (ADR-700 Amd 2)', () => {
  const TURN = Math.PI * 2;
  /** The former loop, for comparison on ordinary parameters. */
  function looped(start: number, end: number): number {
    let sweep = end - start;
    while (sweep <= 0) sweep += TURN;
    return Math.min(sweep, TURN);
  }

  it('matches the former loop on ordinary parameters', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [0, 0],
      [0, TURN],
      [TURN, 0],
      [-1, 2],
      [5, -9],
      [2, 2 - TURN],
    ];
    for (const [start, end] of cases) expect(normalizedSweep(start, end)).toBe(looped(start, end));
  });

  it('drops whole turns from an ELLIPSE sweep, as ARC does', () => {
    expect(normalizedSweep(0, TURN + Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizedSweep(1, 1 + 2 * TURN)).toBe(TURN);
    expect(normalizedSweep(0.3, 0.3 + TURN * (1 + 1e-15))).toBe(TURN);
  });

  it('works out any parameters in one step, within one turn', () => {
    for (const [start, end] of [
      [1e20, 0],
      [0, -1e20],
      [1e12, 3],
      [Number.MAX_VALUE, -Number.MAX_VALUE],
    ] as const) {
      const sweep = normalizedSweep(start, end);
      expect(sweep).toBeGreaterThan(0);
      expect(sweep).toBeLessThanOrEqual(TURN);
    }
  });
});

describe('a full ELLIPSE written with rounded radians (E3-P1-1)', () => {
  const TURN = Math.PI * 2;

  it.each(['6.28319', '6.2832', '6.28318531', '6.283185307', '6.28318'])('closes 0 → %s', (end) => {
    expect(normalizedSweep(0, Number(end))).toBe(TURN);
    expect(isFullEllipseSweep(0, Number(end))).toBe(true);
  });

  it('closes every s → s + 2π printed to 4 to 10 decimals', () => {
    let state = 7;
    for (let decimals = 4; decimals <= 10; decimals += 1) {
      for (let i = 0; i < 2000; i += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const start = (state / 2 ** 32) * TURN;
        const written = (value: number): number => Number(value.toFixed(decimals));
        expect(isFullEllipseSweep(written(start), written(start + TURN))).toBe(true);
      }
    }
  });

  it.each([
    [0, 1e-5],
    [6.28318, 0],
    [1, 1.001],
    [0, TURN + 0.01],
  ])('keeps the small sweep %s → %s small', (start, end) => {
    expect(normalizedSweep(start, end)).toBeLessThan(0.02);
    expect(isFullEllipseSweep(start, end)).toBe(false);
  });

  it('imports 0 → 6.28319 as the closed outline, not a dot', () => {
    const tags: Array<[number, string]> = [
      [0, 'SECTION'],
      [2, 'ENTITIES'],
      [0, 'ELLIPSE'],
      [10, '0'],
      [20, '0'],
      [11, '69'],
      [21, '0'],
      [40, '0.5'],
      [41, '0'],
      [42, '6.28319'],
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ];
    const dxfText = tags.map(([code, value]) => `${code}\n${value}\n`).join('');
    const result = parseDxf({ dxfText, id: 'e', source: 'e.dxf' });
    if (result.kind !== 'ok' || result.object === null) throw new Error('no ellipse imported');
    const { bounds, paths } = result.object;
    expect(bounds.maxX - bounds.minX).toBeCloseTo(138, 3);
    expect(paths[0]?.polylines[0]?.closed).toBe(true);
  });
});
