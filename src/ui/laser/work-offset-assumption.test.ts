// Before the first WCO report KerfDesk places Absolute and Current Position
// jobs at an assumed zero work offset. Job Review names that assumption only
// for controllers whose status reports carry WCO, where the offset is merely
// not reported yet (ADR-375).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568

import { describe, expect, it } from 'vitest';
import {
  fluidncDriver,
  grblDriver,
  marlinDriver,
  smoothiewareDriver,
} from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { placementAssumesZeroWorkOffset, type MachinePlacementSnapshot } from '../job-placement';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob, type MachineStartSnapshot } from './start-job-readiness';
import {
  controllerReportsWorkOffset,
  WORK_OFFSET_ASSUMED_ZERO_WARNING,
  workOffsetAssumptionWarnings,
} from './work-offset-assumption';

const ZERO = { x: 0, y: 0, z: 0 };

function idle(fields: Partial<StatusReport> = {}): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 10, y: 20, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
    ...fields,
  };
}

function machine(fields: Partial<MachinePlacementSnapshot> = {}): MachinePlacementSnapshot {
  return { statusReport: idle(), wcoCache: null, workOriginActive: false, ...fields };
}

function lineProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'O1',
          source: 'a.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('controllerReportsWorkOffset', () => {
  it('holds for GRBL-family realtime reports, which carry WCO', () => {
    expect(controllerReportsWorkOffset(grblDriver.capabilities)).toBe(true);
    expect(controllerReportsWorkOffset(fluidncDriver.capabilities)).toBe(true);
  });

  // Smoothieware's offset is MPos minus WPos in every report, and Marlin's is
  // the shift KerfDesk records; neither has a WCO field to wait for.
  it('does not hold for controllers whose reports have no WCO field', () => {
    expect(controllerReportsWorkOffset(smoothiewareDriver.capabilities)).toBe(false);
    expect(controllerReportsWorkOffset(marlinDriver.capabilities)).toBe(false);
  });
});

describe('placementAssumesZeroWorkOffset', () => {
  it('holds for Absolute until a WCO is known', () => {
    expect(placementAssumesZeroWorkOffset('absolute', machine())).toBe(true);
    expect(placementAssumesZeroWorkOffset('absolute', machine({ wcoCache: ZERO }))).toBe(false);
    expect(
      placementAssumesZeroWorkOffset('absolute', machine({ statusReport: idle({ wco: ZERO }) })),
    ).toBe(false);
  });

  it('does not hold while a custom origin is set, which refuses instead of assuming', () => {
    expect(placementAssumesZeroWorkOffset('absolute', machine({ workOriginActive: true }))).toBe(
      false,
    );
  });

  it('holds for Current Position only when its report carries one position', () => {
    const mPosOnly = idle();
    const wPosOnly = idle({ mPos: null, wPos: { x: 1, y: 2, z: 0 } });
    const both = idle({ wPos: { x: 1, y: 2, z: 0 } });
    const neither = idle({ mPos: null });
    const at = (statusReport: StatusReport | null) =>
      placementAssumesZeroWorkOffset('current-position', machine({ statusReport }));
    expect(at(mPosOnly)).toBe(true);
    expect(at(wPosOnly)).toBe(true);
    // MPos minus WPos is the offset itself; with neither, placement refuses.
    expect(at(both)).toBe(false);
    expect(at(neither)).toBe(false);
    expect(at(null)).toBe(false);
  });

  it('does not hold for origin-relative placements, which use no offset', () => {
    expect(placementAssumesZeroWorkOffset('user-origin', machine())).toBe(false);
    expect(placementAssumesZeroWorkOffset('verified-origin', machine())).toBe(false);
  });
});

describe('workOffsetAssumptionWarnings', () => {
  const snapshot = (fields: Partial<MachineStartSnapshot> = {}): MachineStartSnapshot => ({
    statusReport: idle(),
    alarmCode: null,
    hasActiveStreamer: false,
    wcoCache: null,
    workOriginActive: false,
    reportsWorkOffset: true,
    ...fields,
  });

  it('names the assumed zero for a controller that reports WCO', () => {
    expect(workOffsetAssumptionWarnings({ ok: true }, snapshot())).toEqual([
      WORK_OFFSET_ASSUMED_ZERO_WARNING,
    ]);
  });

  it('says nothing once WCO is known, for other controllers, or for User Origin', () => {
    expect(workOffsetAssumptionWarnings({ ok: true }, snapshot({ wcoCache: ZERO }))).toEqual([]);
    expect(
      workOffsetAssumptionWarnings({ ok: true }, snapshot({ reportsWorkOffset: false })),
    ).toEqual([]);
    expect(
      workOffsetAssumptionWarnings(
        { ok: true, jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' } },
        snapshot({ workOriginActive: true, wcoCache: { x: 5, y: 5, z: 0 } }),
      ),
    ).toEqual([]);
  });

  it('reaches the Start preparation Job Review shows', () => {
    const project = lineProject();
    const settings = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
    const warningsWith = (fields: Partial<MachineStartSnapshot>): ReadonlyArray<string> => {
      const prepared = prepareStartJob(project, settings, {
        ...snapshot(fields),
        frameVerification: frameVerificationForProject(project),
      });
      if (!prepared.ok) throw new Error(prepared.messages.join('; '));
      return prepared.warnings;
    };

    expect(warningsWith({})).toContain(WORK_OFFSET_ASSUMED_ZERO_WARNING);
    expect(warningsWith({ wcoCache: ZERO })).not.toContain(WORK_OFFSET_ASSUMED_ZERO_WARNING);
    expect(warningsWith({ reportsWorkOffset: false })).not.toContain(
      WORK_OFFSET_ASSUMED_ZERO_WARNING,
    );
  });
});
