// DXF ARC sweeps over one turn are reduced into (0, 2π] (code quality audit
// C2 D5-P1-2): an ARC from 0° to 450° is a quarter arc, not a quarter arc
// burned on top of a full circle.

import { describe, expect, it } from 'vitest';
import { arcSweep } from './dxf-entities';
import { parseDxf } from './parse-dxf';

const DEG = Math.PI / 180;
const TURN = Math.PI * 2;

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
