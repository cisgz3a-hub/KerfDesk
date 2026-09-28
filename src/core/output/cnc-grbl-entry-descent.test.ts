import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CNC_AIR_RAPID_CLEARANCE_MM } from '../cnc/cnc-air-floor';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

// ADR-489: a pass with a proven air floor is rapided down to just above it
// and plunged the rest of the way at the plunge feed.

const SAFE_Z_MM = 5;

function group(passes: ReadonlyArray<CncPass>, retractBetweenPasses = false): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'pocket',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: SAFE_Z_MM,
    retractBetweenPasses,
    passes,
  };
}

function emit(passes: ReadonlyArray<CncPass>, retractBetweenPasses = false): string {
  return cncGrblStrategy.emit(
    { groups: [group(passes, retractBetweenPasses)] },
    DEFAULT_DEVICE_PROFILE,
  );
}

function motionLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter((line) => /^G[0-3]\b/.test(line));
}

const firstLevel: CncPass = {
  kind: 'contour',
  zMm: -3,
  polyline: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ],
  closed: false,
};

describe('entry descent over a proven air floor (ADR-489)', () => {
  it('rapids a contour pass down to the floor plus the clearance, then plunges', () => {
    const next: CncPass = {
      kind: 'contour',
      zMm: -6,
      polyline: [
        { x: 10, y: 10 },
        { x: 15, y: 10 },
      ],
      closed: false,
      airFloorZMm: -3,
    };
    const lines = motionLines(emit([firstLevel, next]));
    const entry = lines.indexOf('G0 X10.000 Y10.000');
    expect(lines.slice(entry, entry + 3)).toEqual([
      'G0 X10.000 Y10.000',
      `G0 Z${(-3 + CNC_AIR_RAPID_CLEARANCE_MM).toFixed(3)}`,
      'G1 Z-6.000 F300',
    ]);
  });

  it('does the same for path3d and arc passes', () => {
    const path3d: CncPass = {
      kind: 'path3d',
      points: [
        { x: 10, y: 10, z: -4 },
        { x: 12, y: 10, z: -5 },
      ],
      closed: false,
      airFloorZMm: -2.5,
    };
    const arc: CncPass = {
      kind: 'arc',
      start: { x: 30, y: 0 },
      end: { x: 40, y: 0 },
      center: { x: 35, y: 0 },
      clockwise: true,
      zMm: -5,
      closed: false,
      airFloorZMm: -2,
    };
    const gcode = emit([firstLevel, path3d, arc]);
    expect(gcode).toContain('G0 X10.000 Y10.000\nG0 Z-1.500\nG1 Z-4.000 F300\n');
    expect(gcode).toContain('G0 X30.000 Y0.000\nG0 Z-1.000\nG1 Z-5.000 F300\n');
    expect(findPlungedTravelIssues(gcode, { safeZMm: SAFE_Z_MM })).toEqual([]);
  });

  it('plunges from safe Z as before without a floor, or when the floor gains nothing', () => {
    const at = (airFloorZMm?: number): CncPass => ({
      kind: 'contour',
      zMm: -2,
      polyline: [
        { x: 10, y: 10 },
        { x: 15, y: 10 },
      ],
      closed: false,
      ...(airFloorZMm === undefined ? {} : { airFloorZMm }),
    });
    const plain = emit([firstLevel, at()]);
    // The rapid would stop at or below the pass's own start, or at or above safe Z.
    for (const floor of [-3, -3.5, SAFE_Z_MM - CNC_AIR_RAPID_CLEARANCE_MM, 10, Number.NaN]) {
      expect(emit([firstLevel, at(floor)])).toBe(plain);
    }
    expect(plain).toContain('G0 X10.000 Y10.000\nG1 Z-2.000 F300\n');
  });

  it('never rapids down from inside a cut, only from safe Z', () => {
    // The second pass starts where the first ended, so the head stays down.
    const deeper: CncPass = {
      kind: 'contour',
      zMm: -6,
      polyline: [
        { x: 20, y: 0 },
        { x: 0, y: 0 },
      ],
      closed: false,
      airFloorZMm: -3,
    };
    const chained = motionLines(emit([firstLevel, deeper]));
    expect(chained.filter((line) => line.startsWith('G0 Z-'))).toEqual([]);
    // Lifting between passes returns to safe Z first, and then the floor applies.
    const lifted = motionLines(emit([firstLevel, deeper], true));
    expect(lifted).toContain('G0 Z-2.000');
  });

  it('keeps every emitted job with honest floors free of plunged travel (200 seeds)', () => {
    const coordinate = fc.integer({ min: 0, max: 5000 }).map((n) => n / 50);
    const depth = fc.integer({ min: -1000, max: -10 }).map((n) => n / 100);
    const passSpec = fc.record({
      kind: fc.constantFrom<PassSpec['kind']>('contour', 'path3d', 'arc'),
      points: fc.array(fc.record({ x: coordinate, y: coordinate }), { minLength: 2, maxLength: 5 }),
      z: depth,
      floorAbove: fc.option(fc.integer({ min: 0, max: 400 }).map((n) => n / 100)),
    });
    fc.assert(
      fc.property(fc.array(passSpec, { minLength: 1, maxLength: 6 }), (specs) => {
        // A floor is honest only above what earlier passes have cut.
        let deepestCutMm: number | null = null;
        const passes = specs.map((spec): CncPass => {
          const floor =
            spec.floorAbove === null || deepestCutMm === null
              ? {}
              : { airFloorZMm: deepestCutMm + spec.floorAbove };
          deepestCutMm = Math.min(deepestCutMm ?? spec.z, spec.z);
          return passFromSpec(spec, floor);
        });
        const gcode = emit(passes);
        expect(findPlungedTravelIssues(gcode, { safeZMm: SAFE_Z_MM })).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

type PassSpec = {
  readonly kind: 'contour' | 'path3d' | 'arc';
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly z: number;
};

function passFromSpec(spec: PassSpec, floor: { readonly airFloorZMm?: number }): CncPass {
  const [a, b] = spec.points as [{ x: number; y: number }, { x: number; y: number }];
  switch (spec.kind) {
    case 'contour':
      return { kind: 'contour', zMm: spec.z, polyline: spec.points, closed: false, ...floor };
    case 'path3d':
      return {
        kind: 'path3d',
        points: spec.points.map((point, index) => ({ ...point, z: index === 0 ? spec.z : -0.5 })),
        closed: false,
        ...floor,
      };
    case 'arc':
      return {
        kind: 'arc',
        start: a,
        end: b,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        clockwise: true,
        zMm: spec.z,
        closed: false,
        ...floor,
      };
  }
}
