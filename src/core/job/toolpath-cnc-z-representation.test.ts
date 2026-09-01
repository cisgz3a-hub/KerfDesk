import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncContourEmissionPoints } from '../cnc/cnc-contour-emission';
import { parseGrblCncCoordinate } from '../cnc/coordinate-representation';
import { formatCncCoordinateMm } from '../cnc/cnc-output-precision';
import { cncGrblStrategy } from '../output';
import type { CncGroup, CncPass, Job } from './job';
import { buildToolpath } from './toolpath';

function group(passes: ReadonlyArray<CncPass>): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'represented-z',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

const REPRESENTED_PASSES = [
  [
    'contour',
    {
      kind: 'contour',
      zMm: -0.0506,
      polyline: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
      closed: false,
    },
  ],
  [
    'arc',
    {
      kind: 'arc',
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -0.0506,
      closed: false,
    },
  ],
  [
    'path3d',
    {
      kind: 'path3d',
      points: [
        { x: 0, y: 0, z: -0.0104 },
        { x: 3, y: 4, z: -0.0506 },
      ],
      closed: false,
    },
  ],
  [
    'helical-contour',
    {
      kind: 'helical-contour',
      start: { x: 5, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      startZMm: 0,
      zMm: -0.0506,
      revolutions: 2,
      polyline: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: false,
    },
  ],
] as const satisfies ReadonlyArray<readonly [string, CncPass]>;

describe('CNC toolpath represented Z', () => {
  it.each(REPRESENTED_PASSES)(
    'previews the represented %s Z written by the emitter',
    (_kind, pass) => {
      const job: Job = { groups: [group([pass])] };
      const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');
      if (cut?.kind !== 'cut') throw new Error('expected represented cut');
      const depths = cut.zs ?? (cut.z === undefined ? [] : [cut.z.from, cut.z.to]);

      expect(Math.min(...depths)).toBe(parseGrblCncCoordinate('-0.051'));
      expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain('Z-0.051');
    },
  );

  it('interpolates helix preview between each represented emitted seam', () => {
    const helix: CncPass = {
      kind: 'helical-contour',
      start: { x: 5, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      startZMm: 0,
      zMm: -0.0512,
      revolutions: 2,
      polyline: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: false,
    };
    const job: Job = { groups: [group([helix])] };
    const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');
    if (cut?.kind !== 'cut' || cut.zs === undefined) throw new Error('expected sampled helix');
    const seamDepths = cut.polyline.flatMap((point, index) =>
      Math.abs(point.x - helix.start.x) < 1e-9 && Math.abs(point.y - helix.start.y) < 1e-9
        ? [cut.zs?.[index]]
        : [],
    );

    expect(seamDepths.map((depth) => formatCncCoordinateMm(depth ?? 0))).toEqual([
      '0.000',
      '-0.026',
      '-0.051',
    ]);
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain('Z-0.026 I-5.000 J0.000');
  });

  it('does not parse an ordinary plunge twice at a non-idempotent GRBL float boundary', () => {
    const pass: CncPass = {
      kind: 'contour',
      zMm: -6553.606,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    };
    const job: Job = { groups: [group([pass])] };
    const steps = buildToolpath(job).steps;
    const plunge = steps.find((step) => step.kind === 'plunge');
    const cut = steps.find((step) => step.kind === 'cut');
    const represented = parseGrblCncCoordinate('-6553.606');

    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain('G1 Z-6553.606');
    expect(plunge?.kind === 'plunge' ? plunge.toZ : null).toBe(represented);
    expect(cut?.kind === 'cut' ? cut.z : null).toEqual({ from: represented, to: represented });
  });

  it('retains fine represented XY motion and represented Z in the same contour', () => {
    const pass: CncPass = {
      kind: 'contour',
      zMm: -0.0506,
      polyline: [
        { x: 10, y: 20 },
        { x: 10.0004, y: 20.0004 },
      ],
      closed: false,
    };
    const job: Job = { groups: [group([pass])] };
    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');

    expect(gcode).toContain('G1 Z-0.051');
    expect(gcode).toContain('G1 X10.0004 Y20.0004');
    expect(cut?.kind === 'cut' ? cut.polyline : null).toEqual(cncContourEmissionPoints(pass));
    expect(cut?.kind === 'cut' ? cut.z : null).toEqual({
      from: parseGrblCncCoordinate('-0.051'),
      to: parseGrblCncCoordinate('-0.051'),
    });
  });

  it('uses the same single-formatted seam text and preview value for a large helix', () => {
    const helix: CncPass = {
      kind: 'helical-contour',
      start: { x: 5, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      startZMm: -6553.604,
      zMm: -6553.606,
      revolutions: 2,
      polyline: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: false,
    };
    const job: Job = { groups: [group([helix])] };
    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');
    if (cut?.kind !== 'cut' || cut.zs === undefined) throw new Error('expected sampled helix');
    const seamDepths = cut.polyline.flatMap((point, index) =>
      Math.abs(point.x - helix.start.x) < 1e-9 && Math.abs(point.y - helix.start.y) < 1e-9
        ? [cut.zs?.[index]]
        : [],
    );

    expect(gcode).toContain('Z-6553.605 I-5.000 J0.000');
    expect(gcode).toContain('Z-6553.606 I-5.000 J0.000');
    expect(seamDepths).toEqual([
      parseGrblCncCoordinate('-6553.604'),
      parseGrblCncCoordinate('-6553.605'),
      parseGrblCncCoordinate('-6553.606'),
    ]);
  });
});
