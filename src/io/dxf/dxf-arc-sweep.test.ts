// DXF ARC sweeps over one turn are reduced into (0, 2π] (code quality audit
// C2 D5-P1-2): an ARC from 0° to 450° is a quarter arc, not a quarter arc
// burned on top of a full circle.

import { describe, expect, it } from 'vitest';
import { arcSweep } from './dxf-entities';
import { parseDxf } from './parse-dxf';

const DEG = Math.PI / 180;
const TURN = Math.PI * 2;

/** A repeatable stream of numbers in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The former loop, which every sweep within one turn must still match. */
function looped(startDeg: number, endDeg: number): number {
  let sweep = endDeg * DEG - startDeg * DEG;
  while (sweep <= 0) sweep += TURN;
  return sweep;
}

describe('arcSweep', () => {
  it.each([
    [0, 450, 90],
    [-360, 90, 90],
    [0, 720, 360],
    [30, 1110, 360],
    [45, 1485, 360],
    [10, 820, 90],
    [400, 0, 320],
  ])('reduces %s° → %s° to %s°', (start, end, degrees) => {
    expect(arcSweep(start, end)).toBeCloseTo(degrees * DEG, 12);
  });

  it.each([
    [-90, 90],
    [-720, -630],
    [0, 90],
    [350, 10],
    [10, 350],
    [0, 0],
    [0, 360],
    [12.5, 12.5],
    [90, -180],
  ])('keeps %s° → %s° exactly as before', (start, end) => {
    expect(arcSweep(start, end)).toBe(looped(start, end));
  });

  it.each([
    [152.2, 512.2],
    [1.4, 361.40000000000003],
    [0, 360.00000000000006],
    [152.2, -207.8],
    [1.4, -358.6],
  ])('keeps the full circle %s° → %s° written with rounded decimals', (start, end) => {
    expect(arcSweep(start, end)).toBe(TURN);
  });

  it.each([
    [12.3457, 372.346],
    [12.3457, 372.345],
    [372.346, 12.3457],
    [0.00123456, 360.001],
  ])('keeps the full circle %s° → %s° written to 6 significant digits', (start, end) => {
    expect(arcSweep(start, end)).toBe(TURN);
  });

  it('keeps every s → s + 360 a full circle at 6 to 12 significant digits (E3-P1-2)', () => {
    const random = seeded(20261112);
    for (let digits = 6; digits <= 12; digits += 1) {
      for (let i = 0; i < 2000; i += 1) {
        const start = random() * 360;
        const written = (value: number): number => Number(value.toPrecision(digits));
        expect(arcSweep(written(start), written(start + 360))).toBe(TURN);
      }
    }
  });

  it.each([
    [359.99, 0.01, 0.02],
    [10, 10.01, 0.01],
    [0, 0.0001, 0.0001],
    [360, 0.0001, 0.0001],
    [0, 360.5, 0.5],
  ])('keeps the small arc %s° → %s° (%s°) small', (start, end, degrees) => {
    expect(arcSweep(start, end)).toBeCloseTo(degrees * DEG, 12);
  });

  it('works out any angles in one step, within one turn', () => {
    for (const [start, end] of [
      [1e20, 0],
      [0, 1e20],
      [-1e300, 1e300],
      [Infinity, 0],
    ] as const) {
      const sweep = arcSweep(start, end);
      expect(sweep).toBeGreaterThan(0);
      expect(sweep).toBeLessThanOrEqual(TURN);
    }
  });
});

describe('importing an ARC of more than one turn', () => {
  function arcObject(start: string, end: string) {
    const body = [
      [0, 'SECTION'],
      [2, 'ENTITIES'],
      [0, 'ARC'],
      [10, '0'],
      [20, '0'],
      [40, '10'],
      [50, start],
      [51, end],
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ]
      .map(([code, value]) => `${code}\n${value}`)
      .join('\n');
    const result = parseDxf({ dxfText: body + '\n', id: 'arc', source: 'arc.dxf' });
    if (result.kind !== 'ok' || result.object === null) throw new Error('no arc imported');
    return result.object;
  }

  it('imports 0° → 450° as the same quarter arc as 0° → 90°', () => {
    const multi = arcObject('0', '450');
    const quarter = arcObject('0', '90');
    expect(multi.paths[0]?.curves).toEqual(quarter.paths[0]?.curves);
    expect(multi.paths[0]?.polylines).toEqual(quarter.paths[0]?.polylines);
  });

  it('imports 0° → 720° as one circle, as 0° → 360°', () => {
    const twice = arcObject('0', '720');
    const once = arcObject('0', '360');
    expect(twice.paths[0]?.curves).toEqual(once.paths[0]?.curves);
    expect(twice.bounds.maxX - twice.bounds.minX).toBeCloseTo(20, 6);
  });
});
