import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function squareLoop(at: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

function group(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      { kind: 'contour', zMm: -1.5, polyline: squareLoop(10, 20), closed: true },
      { kind: 'contour', zMm: -3, polyline: squareLoop(10, 20), closed: true },
    ],
    ...overrides,
  };
}

describe('cncGrblStrategy', () => {
  it('emits the CNC preamble: units, absolute, feed mode, spindle, dwell', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    // The safe-Z lift comes BEFORE M3: after touch-off the bit rests on the
    // stock top, and the spindle must not spin up there.
    expect(gcode.startsWith('G21\nG90\nG94\nG0 Z3.810\nM3 S12000\nG4 P3.000\n')).toBe(true);
  });

  it('retracts before XY travel and plunges at the plunge feed', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    expect(gcode).toContain('G0 Z3.810\nM3 S12000');
    expect(gcode).toContain('G0 X10.000 Y10.000\nG1 Z-1.500 F300');
    expect(gcode).toContain('G1 X30.000 Y10.000 F1000');
  });

  it('skips the retract when the next depth pass starts at the same XY', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    // The loop closes at X10 Y10, then the deeper pass plunges directly.
    expect(gcode).toContain('G1 X10.000 Y10.000\nG1 Z-3.000 F300');
  });

  it('ends with retract, spindle off, and XY park', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    expect(gcode.endsWith('G0 Z3.810\nM5\nG0 X0.000 Y0.000\n')).toBe(true);
  });

  it('never travels XY with the bit below the safe height', () => {
    const jobs: Job[] = [
      { groups: [group()] },
      {
        groups: [
          group(),
          group({
            layerId: 'L2',
            spindleRpm: 8000,
            passes: [{ kind: 'contour', zMm: -2, polyline: squareLoop(60, 15), closed: true }],
          }),
        ],
      },
    ];
    for (const job of jobs) {
      const gcode = cncGrblStrategy.emit(job, dev);
      expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
    }
  });

  it('re-issues spindle speed with a dwell when RPM changes between groups', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [group(), group({ layerId: 'L2', spindleRpm: 8000, passes: group().passes })],
      },
      dev,
    );
    expect(gcode).toContain('M3 S8000\nG4 P3.000');
  });

  it('is byte-deterministic', () => {
    const job: Job = { groups: [group()] };
    expect(cncGrblStrategy.emit(job, dev)).toBe(cncGrblStrategy.emit(job, dev));
  });

  it('emits nothing for a job with no cnc groups', () => {
    const laserJob: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#ff0000',
          power: 50,
          speed: 1000,
          passes: 1,
          airAssist: false,
          segments: [],
        },
      ],
    };
    expect(cncGrblStrategy.emit(laserJob, dev)).toBe('');
  });

  describe('arc passes', () => {
    it('emits native G2/G3 arcs with I/J center offsets at the cut feed', () => {
      const gcode = cncGrblStrategy.emit(
        {
          groups: [
            group({
              passes: [
                {
                  kind: 'arc',
                  start: { x: 10, y: 10 },
                  end: { x: 20, y: 20 },
                  center: { x: 10, y: 20 },
                  clockwise: false,
                  zMm: -1.5,
                  closed: false,
                },
              ],
            }),
          ],
        },
        dev,
      );

      expect(gcode).toContain(
        'G0 X10.000 Y10.000\nG1 Z-1.500 F300\nG3 X20.000 Y20.000 I0.000 J10.000 F1000',
      );
      expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
    });

    it('falls back to linear G1 motion for arcs that cannot be emitted safely as native arcs', () => {
      const gcode = cncGrblStrategy.emit(
        {
          groups: [
            group({
              passes: [
                {
                  kind: 'arc',
                  start: { x: 10, y: 10 },
                  end: { x: 20, y: 10 },
                  center: { x: 10, y: 10 },
                  clockwise: true,
                  zMm: -1,
                  closed: false,
                },
              ],
            }),
          ],
        },
        dev,
      );

      expect(gcode).not.toMatch(/^G2\b/m);
      expect(gcode).not.toMatch(/^G3\b/m);
      expect(gcode).toContain('G1 X20.000 Y10.000 F1000');
      expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
    });
  });

  describe('path3d passes (Phase H.1)', () => {
    const ramp = group({
      passes: [
        {
          kind: 'path3d',
          points: [
            { x: 10, y: 10, z: -0.5 },
            { x: 30, y: 10, z: -1.5 },
            { x: 30, y: 30, z: -2.5 },
          ],
          closed: false,
        },
      ],
    });

    it('retracts, rapids to the first XY, plunges to the FIRST vertex Z at plunge feed', () => {
      const gcode = cncGrblStrategy.emit({ groups: [ramp] }, dev);
      // The safe-Z retract now lives in the preamble (before M3); the pass
      // itself rapids to XY and plunges to the first vertex Z.
      expect(gcode).toContain('G0 Z3.810\nM3 S12000');
      expect(gcode).toContain('G0 X10.000 Y10.000\nG1 Z-0.500 F300');
    });

    it('feeds per-vertex XYZ moves with the feed word only on the first', () => {
      const gcode = cncGrblStrategy.emit({ groups: [ramp] }, dev);
      expect(gcode).toContain('G1 X30.000 Y10.000 Z-1.500 F1000\nG1 X30.000 Y30.000 Z-2.500');
    });

    it('in-cut Z changes ride G1, never G0 — the motion invariant holds', () => {
      const gcode = cncGrblStrategy.emit({ groups: [ramp] }, dev);
      expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
    });

    it('pure-vertical path3d segments plunge at the PLUNGE feed, then restore the cut feed', () => {
      // A ramp longer than its path ends with a same-XY descent to depth
      // (motion-polish short-path arm). That vertical move must not ride the
      // XY cutting feed — an end mill plunging straight down at 1000 mm/min
      // instead of 300 breaks bits and burns stock.
      const short = group({
        passes: [
          {
            kind: 'path3d',
            points: [
              { x: 10, y: 10, z: -0.5 },
              { x: 12, y: 10, z: -1.0 },
              { x: 12, y: 10, z: -3.0 },
              { x: 20, y: 10, z: -3.0 },
            ],
            closed: false,
          },
        ],
      });
      const gcode = cncGrblStrategy.emit({ groups: [short] }, dev);
      expect(gcode).toContain('G1 X12.000 Y10.000 Z-3.000 F300');
      expect(gcode).toContain('G1 X20.000 Y10.000 Z-3.000 F1000');
    });

    it('skips the retract+rapid when a path3d pass starts at the current XY', () => {
      const chained = group({
        passes: [
          { kind: 'contour', zMm: -1, polyline: squareLoop(10, 20), closed: true },
          {
            kind: 'path3d',
            points: [
              { x: 10, y: 10, z: -1.5 },
              { x: 12, y: 10, z: -2 },
            ],
            closed: false,
          },
        ],
      });
      const gcode = cncGrblStrategy.emit({ groups: [chained] }, dev);
      // The loop closes at X10 Y10; the path3d pass plunges straight down.
      expect(gcode).toContain('G1 X10.000 Y10.000\nG1 Z-1.500 F300');
    });

    it('drops degenerate path3d passes (fewer than 2 points)', () => {
      const degenerate = group({
        passes: [{ kind: 'path3d', points: [{ x: 5, y: 5, z: -1 }], closed: false }],
      });
      const gcode = cncGrblStrategy.emit({ groups: [degenerate] }, dev);
      expect(gcode).not.toContain('X5.000');
    });
  });
});
