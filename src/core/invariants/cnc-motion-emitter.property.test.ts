import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { findPlungedTravelIssues } from './cnc-motion';

// Property: any CNC job the emitter produces keeps every rapid above safe Z.
// This permanently ties the emitter's motion contract to the plunged-travel invariant.
describe('cnc emitter × motion invariant (property)', () => {
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

  it('emitted G-code never travels plunged (100 seeds)', () => {
    fc.assert(
      fc.property(group, (g) => {
        const job: Job = { groups: [g] };
        const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
        expect(findPlungedTravelIssues(gcode, { safeZMm: SAFE_Z_MM })).toEqual([]);
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
