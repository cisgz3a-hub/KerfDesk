import { describe, expect, it } from 'vitest';
import { parseGrblCncCoordinate } from '../cnc/cnc-contour-emission';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import type { CncGroup, CncPass, Job } from './job';
import { buildToolpath } from './toolpath';

const REPRESENTED_SAFE_Z_MM = parseGrblCncCoordinate('3.810');

function group(passes: ReadonlyArray<CncPass>): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

describe('CNC Preview precision boundaries', () => {
  it('retains every parser-representable segment selected for emission', () => {
    const job: Job = {
      groups: [
        group([
          {
            kind: 'contour',
            zMm: -1,
            polyline: [
              { x: 10, y: 20 },
              { x: 10.0004, y: 20 },
              { x: 10.00044, y: 20.00004 },
            ],
            closed: false,
          },
        ]),
      ],
    };
    const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');

    expect(cut?.kind).toBe('cut');
    if (cut?.kind !== 'cut') throw new Error('expected precision-preserving cut');
    expect(cut.polyline).toHaveLength(3);
    expect(cut.length).toBeGreaterThan(0);
  });

  it('repositions from four-decimal contour text into ordinary precision', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 10, y: 20 },
          { x: 10.0004, y: 20.0004 },
          { x: 10, y: 20 },
        ],
        closed: true,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
        closed: false,
      },
    ];

    expect(
      buildToolpath({ groups: [group(passes)] }, { startPoint: { x: 10, y: 20 } }).steps,
    ).toMatchObject([
      { kind: 'plunge', toZ: -1 },
      { kind: 'cut' },
      { kind: 'plunge', fromZ: -1, toZ: REPRESENTED_SAFE_Z_MM },
      { kind: 'travel' },
      { kind: 'plunge', fromZ: REPRESENTED_SAFE_Z_MM, toZ: -2 },
      { kind: 'cut' },
    ]);
  });

  it('uses the represented path3d exit when the following contour starts there', () => {
    const passes: CncPass[] = [
      {
        kind: 'path3d',
        points: [
          { x: 0, y: 0, z: -1 },
          { x: 10.0004, y: 20.0004, z: -1 },
        ],
        closed: false,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
        closed: false,
      },
    ];
    const job: Job = { groups: [group(passes)] };

    expect(buildToolpath(job, { startPoint: { x: 0, y: 0 } }).steps).toMatchObject([
      { kind: 'plunge', toZ: -1 },
      { kind: 'cut' },
      { kind: 'plunge', fromZ: -1, toZ: -2 },
      { kind: 'cut' },
    ]);
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).not.toContain('G0 X10.0000 Y20.0000');
  });

  it('retracts for a fine-contour exit followed by a distinct path3d start', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 10, y: 20 },
          { x: 10.0004, y: 20.0004 },
        ],
        closed: false,
      },
      {
        kind: 'path3d',
        points: [
          { x: 10, y: 20, z: -2 },
          { x: 30, y: 20, z: -2 },
        ],
        closed: false,
      },
    ];
    const job: Job = { groups: [group(passes)] };
    const steps = buildToolpath(job, { startPoint: { x: 10, y: 20 } }).steps;

    expect(steps.map((step) => step.kind)).toEqual([
      'plunge',
      'cut',
      'plunge',
      'travel',
      'plunge',
      'cut',
    ]);
    const travel = steps[3];
    if (travel?.kind !== 'travel') throw new Error('expected mixed-kind boundary travel');
    expect(travel.from).toEqual({
      x: parseGrblCncCoordinate('10.0004'),
      y: parseGrblCncCoordinate('20.0004'),
    });
    expect(travel.to).toEqual({
      x: parseGrblCncCoordinate('10.000'),
      y: parseGrblCncCoordinate('20.000'),
    });
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain('G0 X10.000 Y20.000');
  });

  it('repositions a detail contour returning to ordinary path3d text', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 10, y: 20 },
          { x: 10.0004, y: 20.0004 },
          { x: 10, y: 20 },
        ],
        closed: true,
      },
      {
        kind: 'path3d',
        points: [
          { x: 10, y: 20, z: -2 },
          { x: 30, y: 20, z: -2 },
        ],
        closed: false,
      },
    ];
    const job: Job = { groups: [group(passes)] };

    expect(buildToolpath(job, { startPoint: { x: 10, y: 20 } }).steps).toMatchObject([
      { kind: 'plunge', toZ: -1 },
      { kind: 'cut' },
      { kind: 'plunge', fromZ: -1, toZ: REPRESENTED_SAFE_Z_MM },
      { kind: 'travel' },
      { kind: 'plunge', fromZ: REPRESENTED_SAFE_Z_MM, toZ: -2 },
      { kind: 'cut' },
    ]);
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain('G0 X10.000 Y20.000');
  });

  it('keeps a represented 0.0004 mm contour-boundary move', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        closed: false,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 10.0004, y: 20.0004 },
          { x: 10, y: 20 },
          { x: 10.0004, y: 20.0004 },
        ],
        closed: true,
      },
    ];
    const steps = buildToolpath({ groups: [group(passes)] }, { startPoint: { x: 0, y: 0 } }).steps;

    expect(steps.map((step) => step.kind)).toEqual([
      'plunge',
      'cut',
      'plunge',
      'travel',
      'plunge',
      'cut',
    ]);
    const travel = steps[3];
    if (travel?.kind !== 'travel') throw new Error('expected represented boundary travel');
    expect(travel.to).toEqual({
      x: parseGrblCncCoordinate('10.0004'),
      y: parseGrblCncCoordinate('20.0004'),
    });
  });

  it('repositions to a detail start when equal decimal text parses differently', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 500, y: 20 },
          { x: 512.017, y: 20 },
        ],
        closed: false,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 512.017, y: 20 },
          { x: 512.0171, y: 20 },
        ],
        closed: false,
      },
    ];
    const job: Job = { groups: [group(passes)] };
    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    const secondPlunge = gcode.indexOf('G1 Z-2.000 F300');

    expect(gcode).toContain('G0 X512.0170 Y20.0000');
    expect(gcode.indexOf('G1 X512.0171 Y20.0000 F1000')).toBeGreaterThan(secondPlunge);
    expect(
      buildToolpath(job, { startPoint: { x: 500, y: 20 } }).steps.map((step) => step.kind),
    ).toEqual(['plunge', 'cut', 'plunge', 'travel', 'plunge', 'cut']);
  });

  it('repositions from a represented signed fine-motion exit to ordinary zero', () => {
    const passes: CncPass[] = [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 1, y: 0 },
          { x: -0.00001, y: 0 },
          { x: 0.00001, y: 0 },
        ],
        closed: false,
      },
      {
        kind: 'contour',
        zMm: -2,
        polyline: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        closed: false,
      },
    ];
    const job: Job = { groups: [group(passes)] };

    expect(
      buildToolpath(job, { startPoint: { x: 1, y: 0 } }).steps.map((step) => step.kind),
    ).toEqual(['plunge', 'cut', 'plunge', 'travel', 'plunge', 'cut']);
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toContain(
      'G0 X0.000 Y0.000\nG1 Z-2.000 F300',
    );
  });

  it('previews exact parser-prefix fallback motion', () => {
    const job: Job = {
      groups: [
        group([
          {
            kind: 'contour',
            zMm: -1,
            polyline: [
              { x: 10.1234556, y: 20 },
              { x: 10.1234564, y: 20 },
            ],
            closed: false,
          },
        ]),
      ],
    };
    const cut = buildToolpath(job).steps.find((step) => step.kind === 'cut');

    expect(cut?.kind).toBe('cut');
    if (cut?.kind !== 'cut') throw new Error('expected exact-prefix cut');
    expect(cut.polyline).toHaveLength(2);
    expect(cut.length).toBeGreaterThan(0);
  });
});
