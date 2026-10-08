import { describe, expect, it } from 'vitest';
import {
  parseSurfaceContact,
  surfaceGridCsv,
  surfaceGridModalContext,
  surfaceGridPositions,
  surfaceGridRetouchPlan,
  validateSurfaceContact,
  validateSurfaceGrid,
  type SurfaceGridRequest,
} from './surface-grid-probe';

const REQUEST: SurfaceGridRequest = {
  minX: -10,
  minY: 2,
  maxX: 10,
  maxY: 12,
  columns: 3,
  rows: 2,
  seekFeed: 150,
  probeFeed: 25,
  travelFeed: 500,
  maxTravelMm: 10,
  clearancePrepared: true,
};
describe('measured surface coordinates', () => {
  it('covers inclusive endpoints in a serpentine work-coordinate grid', () => {
    expect(surfaceGridPositions(REQUEST).map((p) => [p.row, p.column, p.x, p.y])).toEqual([
      [0, 0, -10, 2],
      [0, 1, 0, 2],
      [0, 2, 10, 2],
      [1, 2, 10, 12],
      [1, 1, 0, 12],
      [1, 0, -10, 12],
    ]);
  });
  it('rejects unprepared, nonfinite, inverted and excessive requests before motion', () => {
    for (const request of [
      { ...REQUEST, minX: NaN },
      { ...REQUEST, maxX: -11 },
      { ...REQUEST, rows: 21 },
      { ...REQUEST, probeFeed: 150 },
      { ...REQUEST, clearancePrepared: false },
    ])
      expect(() => validateSurfaceGrid(request as SurfaceGridRequest)).toThrow();
  });
  it('normalises successful machine contacts from inches and validates location and travel', () => {
    const contact = parseSurfaceContact(['[PRB:4,8,0.2:1]', 'ok'], true);
    expect(contact).toEqual({ x: 101.6, y: 203.2, z: 5.08 });
    expect(
      validateSurfaceContact(contact, { x: 1.6, y: 3.2 }, { x: 100, y: 200, z: 0 }, 10, 10),
    ).toBeCloseTo(5.08);
    expect(() =>
      validateSurfaceContact(contact, { x: 0, y: 0 }, { x: 100, y: 200, z: 0 }, 10, 10),
    ).toThrow('XY');
    expect(() =>
      validateSurfaceContact(contact, { x: 1.6, y: 3.2 }, { x: 100, y: 200, z: -10 }, 10, 10),
    ).toThrow('Z');
  });
  it('refuses absent, duplicate, failed and malformed contact reports', () => {
    for (const replies of [
      ['ok'],
      ['[PRB:1,2,3:0]'],
      ['[PRB:1,2,:1]'],
      ['[PRB:1,2,3:1]', '[PRB:1,2,3:1]'],
    ])
      expect(() => parseSurfaceContact(replies, false)).toThrow();
  });
  it.each([
    [9, 10, 1, 10, 9],
    [9.99, 10, 1, 10, 9],
    [0.1234, 10, 10, 2.123, 0],
    [-10.001, -10, 1, -10, -11],
  ])(
    'plans bounded representable retouch endpoints from contact %s and clearance %s',
    (fast, clearance, travel, retract, slowTarget) => {
      expect(surfaceGridRetouchPlan(fast, clearance, travel)).toEqual({
        retractZMm: retract,
        slowTargetZMm: slowTarget,
      });
    },
  );
  it('refuses nonfinite/outside-envelope contacts or a release smaller than wire precision', () => {
    for (const fast of [NaN, Infinity, 8.999, 10, 10.001, 9.9995])
      expect(() => surfaceGridRetouchPlan(fast, 10, 1)).toThrow();
    expect(() => surfaceGridRetouchPlan(0, 10.0001, 10)).toThrow('representable');
  });
  it('requires owned ordinary Cartesian work coordinates and rejects rotated/diameter/inverse-time modes', () => {
    expect(
      surfaceGridModalContext(['[GC:G0 G55 G17 G21 G90 G94 M5]'], ['[G55:100,200,5,0:0]']),
    ).toBe('G55');
    for (const [modal, offset] of [
      ['[GC:G55 G94 G7]', '[G55:0,0,0]'],
      ['[GC:G55 G93]', '[G55:0,0,0]'],
      ['[GC:G55 G94]', '[G55:0,0,0:10]'],
    ])
      expect(() => surfaceGridModalContext([modal!], [offset!])).toThrow();
  });
  it('exports portable numeric CSV without commands, file paths or unit identifiers', () => {
    const csv = surfaceGridCsv({
      request: REQUEST,
      points: [{ row: 0, column: 0, x: -10, y: 2, z: 1.25, machineZ: -3.75 }],
      activeWcs: 'G54',
      offsetMm: { x: 100, y: 200, z: -5 },
      clearanceZMm: 10,
      reportInches: false,
      sessionEpoch: 1,
      measuredAt: 1,
      complete: false,
    });
    expect(csv).toContain('1.0000,1.0000,-10.0000,2.0000,1.2500,-3.7500');
    expect(csv).not.toContain('G38');
  });
});
