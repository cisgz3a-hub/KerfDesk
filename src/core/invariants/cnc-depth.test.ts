import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { findPlungedTravelIssues } from './cnc-motion';
import { findOverdeepCutIssues } from './cnc-depth';

describe('findOverdeepCutIssues', () => {
  it('accepts cuts down to the stock floor plus allowance', () => {
    const gcode = [
      'G21',
      'G0 Z3.810',
      'G0 X10.000 Y10.000',
      'G1 Z-7.350 F300',
      'G1 X20.000 Y10.000 F1000',
    ].join('\n');
    expect(findOverdeepCutIssues(gcode, { stockThicknessMm: 6.35 })).toEqual([]);
  });

  it('flags a G1 below the stock floor with the line number', () => {
    const gcode = ['G21', 'G0 Z3.810', 'G1 Z-7.500 F300'].join('\n');
    const issues = findOverdeepCutIssues(gcode, { stockThicknessMm: 6.35 });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.lineNumber).toBe(3);
    expect(issues[0]?.reason).toContain('-7.350');
  });

  it('flags a G0 rapid below the floor too', () => {
    const issues = findOverdeepCutIssues('G0 Z-10.000', { stockThicknessMm: 6.35 });
    expect(issues).toHaveLength(1);
  });

  it('ignores comments and non-motion lines', () => {
    const gcode = ['; plunge Z-99 in a comment', '(Z-99 here too)', 'M3 S12000', 'G4 P3.000'].join(
      '\n',
    );
    expect(findOverdeepCutIssues(gcode, { stockThicknessMm: 1 })).toEqual([]);
  });

  it('honours a custom allowance', () => {
    expect(
      findOverdeepCutIssues('G1 Z-6.500 F300', { stockThicknessMm: 6, allowanceMm: 0 }),
    ).toHaveLength(1);
    expect(
      findOverdeepCutIssues('G1 Z-6.500 F300', { stockThicknessMm: 6, allowanceMm: 1 }),
    ).toEqual([]);
  });
});

// Property: any job the CNC emitter produces from in-stock passes — contour or
// path3d — satisfies BOTH text-level invariants (no plunged travel, no overdeep
// cut). This permanently ties the emitter's motion contract to the invariants.
describe('cnc emitter × depth/motion invariants (property)', () => {
  const STOCK_MM = 10;
  const SAFE_Z_MM = 3.81;

  const point = fc.record({
    x: fc.double({ min: 0, max: 100, noNaN: true }),
    y: fc.double({ min: 0, max: 100, noNaN: true }),
  });
  const depth = fc.double({ min: -STOCK_MM, max: -0.1, noNaN: true });

  const contourPass: fc.Arbitrary<CncPass> = fc
    .record({ polyline: fc.array(point, { minLength: 2, maxLength: 8 }), zMm: depth })
    .map(({ polyline, zMm }) => ({ kind: 'contour', zMm, polyline, closed: false }));

  const path3dPass: fc.Arbitrary<CncPass> = fc
    .array(
      fc.record({
        x: fc.double({ min: 0, max: 100, noNaN: true }),
        y: fc.double({ min: 0, max: 100, noNaN: true }),
        z: depth,
      }),
      { minLength: 2, maxLength: 8 },
    )
    .map((points) => ({ kind: 'path3d', points, closed: false }));

  const group: fc.Arbitrary<CncGroup> = fc
    .array(fc.oneof(contourPass, path3dPass), { minLength: 1, maxLength: 6 })
    .map((passes) => ({
      kind: 'cnc',
      layerId: 'L1',
      color: '#ff0000',
      cutType: 'engrave',
      toolDiameterMm: 3.175,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 3,
      safeZMm: SAFE_Z_MM,
      passes,
    }));

  it('emitted G-code never travels plunged and never cuts below stock (100 seeds)', () => {
    fc.assert(
      fc.property(group, (g) => {
        const job: Job = { groups: [g] };
        const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        expect(findPlungedTravelIssues(gcode, { safeZMm: SAFE_Z_MM })).toEqual([]);
        expect(findOverdeepCutIssues(gcode, { stockThicknessMm: STOCK_MM })).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic: same job emits byte-identical G-code (100 seeds)', () => {
    fc.assert(
      fc.property(group, (g) => {
        const job: Job = { groups: [g] };
        expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toBe(
          cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE),
        );
      }),
      { numRuns: 100 },
    );
  });
});
