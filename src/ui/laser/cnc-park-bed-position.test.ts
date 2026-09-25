// ADR-392 (CNC audit CO-1): the Machine Setup park is a bed position. It used to
// be written as program coordinates while the cuts moved to wherever zero was
// set, so with zero at bed (150, 100) and a park of X0 Y380 the bit-change park
// ran to bed (150, 480), past the back of a 400 mm bed.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { cncParkSetAsideWarning } from './cnc-park-set-aside-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

const PARK_ON_BED = { x: 0, y: 200 };

// Stock GRBL, homed toward native 0,0 at the bed's back-right corner: native
// (0, 0) is bed (358, 268). A G54 at native (-300, -100) is bed (58, 168).
function cncProject(): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    origin: 'front-left',
    bedWidth: 358,
    bedHeight: 268,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
  });
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: {
        ...DEFAULT_CNC_MACHINE_CONFIG.params,
        parkXMm: PARK_ON_BED.x,
        parkYMm: PARK_ON_BED.y,
      },
    },
    scene: {
      layers: [createLayer({ id: 'cut', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 100, y: 100 },
                    { x: 120, y: 100 },
                    { x: 120, y: 120 },
                    { x: 100, y: 120 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function homedWithOrigin(project: Project) {
  const wco = { x: -300, y: -100, z: 0 };
  return {
    ...stockNativeEvidence(project.device),
    alarmCode: null,
    hasActiveStreamer: false,
    workOriginActive: true,
    wcoCache: wco,
    statusReport: {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: -308, y: -238, z: 0 },
      wPos: { x: -8, y: -138, z: 0 },
      wco,
      feed: 0,
      spindle: 0,
    },
  };
}

function finalPark(gcode: string): string | undefined {
  return gcode
    .split('\n')
    .filter((line) => /^G0 X\S+ Y\S+$/.test(line))
    .at(-1);
}

describe('a CNC park is a bed position', () => {
  it('parks a User Origin job at the configured bed point when zero is known on the bed', () => {
    const project = cncProject();
    const machine = homedWithOrigin(project);
    const placement = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      machine,
    );
    if (!placement.ok || placement.jobOrigin === undefined) {
      throw new Error('placement fixture');
    }
    const options = runtimeCoordinatePreparationOptions(project.device, placement, machine);
    expect(options.workZeroBedPosition).toEqual({ x: 58, y: 168 });

    const { gcode } = emitGcode(project, { ...options, jobOrigin: placement.jobOrigin });

    // Program (-58, 32) + zero on the bed (58, 168) = the park's bed point (0, 200).
    expect(finalPark(gcode)).toBe('G0 X-58.000 Y32.000');
  });

  it('parks an Absolute job at the same bed point through the same frame', () => {
    const project = cncProject();
    const machine = homedWithOrigin(project);
    const placement = resolveJobPlacement({ startFrom: 'absolute', anchor: 'front-left' }, machine);
    if (!placement.ok) throw new Error('placement fixture');
    const options = runtimeCoordinatePreparationOptions(project.device, placement, machine);

    const { gcode } = emitGcode(project, { ...options });

    expect(finalPark(gcode)).toBe('G0 X-58.000 Y32.000');
  });

  it('parks at the job start when where zero sits on the bed is unknown', () => {
    const project = cncProject();
    // Saving G-code with no controller: nothing places program zero on the bed.
    const { gcode } = emitGcode(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });

    expect(finalPark(gcode)).toBe('G0 X0.000 Y0.000');
    expect(gcode).not.toContain('G0 X0.000 Y200.000');
  });

  it('tells Job Review when the park is set aside, and only then', () => {
    const project = cncProject();
    const setAside = cncParkSetAsideWarning(PARK_ON_BED.x, PARK_ON_BED.y);
    const unplaced = prepareOutput(project, {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    if (!unplaced.ok) throw new Error('preparation fixture');
    expect(detectMachineJobWarnings(project, null, null, unplaced)).toContain(setAside);

    const machine = homedWithOrigin(project);
    const placement = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      machine,
    );
    if (!placement.ok || placement.jobOrigin === undefined) {
      throw new Error('placement fixture');
    }
    const placed = prepareOutput(project, {
      ...runtimeCoordinatePreparationOptions(project.device, placement, machine),
      jobOrigin: placement.jobOrigin,
    });
    if (!placed.ok) throw new Error('preparation fixture');
    expect(detectMachineJobWarnings(project, null, null, placed)).not.toContain(setAside);
  });
});
