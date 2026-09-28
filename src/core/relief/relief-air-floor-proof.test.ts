import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
import { keepProvenAirFloors } from './relief-air-floor-proof';

const RADIUS_MM = 1.5875;
const CEILING_MM = -2;
const FLOOR_MM = -2;

function line(y: number, zMm: number, fromX = 0, toX = 10): CncContourPass {
  return {
    kind: 'contour',
    zMm,
    polyline: [
      { x: fromX, y },
      { x: toX, y },
    ],
    closed: false,
  };
}

function floored(pass: CncContourPass | CncPath3dPass): CncPass {
  return { ...pass, airFloorZMm: FLOOR_MM };
}

// The floor each pass keeps when the last pass is the one being proven.
function lastKeepsFloor(earlier: ReadonlyArray<CncPass>, last: CncPass, radiusMm = RADIUS_MM) {
  const passes = [...earlier, last];
  const ceilings = passes.map(() => CEILING_MM);
  const kept = keepProvenAirFloors(passes, ceilings, radiusMm);
  const pass = kept[kept.length - 1];
  return pass !== undefined && 'airFloorZMm' in pass;
}

describe('keepProvenAirFloors (ADR-489 Amendment 1)', () => {
  it('does not count a thin strip of tall stock as cleared', () => {
    // A flat bit shifted 0.001 mm meets an uncut strip at the far side.
    // Its small width does not bound its height; a rapid can enter stock.
    expect(lastKeepsFloor([line(0, CEILING_MM)], floored(line(0.001, -3)))).toBe(false);
  });

  it('keeps a floor on a path an earlier cut at the ceiling followed exactly', () => {
    expect(lastKeepsFloor([line(0, CEILING_MM)], floored(line(0, -3)))).toBe(true);
    expect(lastKeepsFloor([line(0, CEILING_MM)], floored(line(0, -3, 2, 8)))).toBe(false);
    // The same closed loop, cut again deeper.
    const square: CncContourPass = {
      kind: 'contour',
      zMm: CEILING_MM,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      closed: true,
    };
    expect(lastKeepsFloor([square], floored({ ...square, zMm: -3 }))).toBe(true);
  });

  it('drops a floor whose sweep reaches past every earlier cut', () => {
    // Sideways by a millimetre: the far side of its sweep was never cut.
    expect(lastKeepsFloor([line(0, CEILING_MM)], floored(line(1, -3)))).toBe(false);
    // Past the earlier cut's end.
    expect(lastKeepsFloor([line(0, CEILING_MM)], floored(line(0, -3, 2, 11)))).toBe(false);
    // Nothing cut before it at all.
    expect(lastKeepsFloor([], floored(line(0, -3)))).toBe(false);
  });

  it('declines area-based coverage until final placed geometry is available', () => {
    const close = [line(0, CEILING_MM), line(2 * RADIUS_MM - 0.1, CEILING_MM)];
    expect(lastKeepsFloor(close, floored(line(RADIUS_MM, -3, 2, 8)))).toBe(false);
    // Merely tangent sweeps cannot survive conservative polygon rounding.
    const tangent = [line(0, CEILING_MM), line(2 * RADIUS_MM, CEILING_MM)];
    expect(lastKeepsFloor(tangent, floored(line(RADIUS_MM, -3, 2, 8)))).toBe(false);
    // 3.5 mm apart: a strip about 0.3 mm wide between them was never cut.
    const apart = [line(0, CEILING_MM), line(3.5, CEILING_MM)];
    expect(lastKeepsFloor(apart, floored(line(1.75, -3, 2, 8)))).toBe(false);
  });

  it('ignores earlier cuts above the ceiling and the risen parts of a 3D path', () => {
    expect(lastKeepsFloor([line(0, CEILING_MM + 0.5)], floored(line(0, -3)))).toBe(false);
    // A ramp from above the ceiling down to it along the line: only the part
    // at or below the ceiling counts.
    const ramp: CncPath3dPass = {
      kind: 'path3d',
      points: [
        { x: 0, y: 0, z: -1 },
        { x: 5, y: 0, z: CEILING_MM },
        { x: 10, y: 0, z: CEILING_MM },
      ],
      closed: false,
    };
    expect(lastKeepsFloor([ramp], floored(line(0, -3, 5, 10)))).toBe(false);
    expect(lastKeepsFloor([ramp], floored(line(0, -3, 3, 10)))).toBe(false);
    const flat: CncPath3dPass = {
      ...ramp,
      points: ramp.points.map((p) => ({ ...p, z: CEILING_MM })),
    };
    expect(
      lastKeepsFloor(
        [flat],
        floored({ ...flat, points: flat.points.map((p) => ({ ...p, z: -3 })) }),
      ),
    ).toBe(true);
  });

  it('keeps no floor without a ceiling or a cutter radius, and leaves other passes alone', () => {
    const earlier = line(0, CEILING_MM);
    const pass = floored(line(0, -3));
    expect(lastKeepsFloor([earlier], pass, 0)).toBe(false);
    expect(lastKeepsFloor([earlier], pass, Number.NaN)).toBe(false);
    const kept = keepProvenAirFloors([earlier, pass], [CEILING_MM, null], RADIUS_MM);
    expect(kept[1]).toEqual(line(0, -3));
    expect(kept[0]).toBe(earlier);
  });
});
