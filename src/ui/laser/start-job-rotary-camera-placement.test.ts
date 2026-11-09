import { describe, expect, it } from 'vitest';
import type { RotarySetup } from '../../core/devices';
import {
  computeJobBounds,
  frameBoundsSignature,
  machineSpaceJob,
  type JobOriginPlacement,
} from '../../core/job';
import { generateCameraBedTarget } from '../../core/job/camera-bed-target-pattern';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import type { FrameVerification } from '../state/frame-verification';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { renderVariableText } from '../text/render-variable-text';
import { prepareStartJob, prepareStartJobSnapshot } from './start-job-readiness';
import {
  cameraPlacementStartFromWarning,
  demotedPolicyWarnings,
  rotaryCameraWarning,
} from './start-job-readiness-policy';

// Rolling audit v11 W4-P2-1, rated P1 by its refuter (ADR-228 Amendment 2).
// On an active rotary the camera advice said "Choose Absolute Coordinates to
// burn it where it is placed". Absolute rebases a rotary job to work Y 0
// (ADR-127), so following it turned the cylinder ~61° away from the face the
// operator set up, and nothing at Absolute said so.

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};
const SCALE = 360 / (Math.PI * 60);
const CAMERA_ADVICE = 'Camera placement is on';
const ABSOLUTE_ADVICE = 'Choose Absolute Coordinates';
const ROTARY_LEAD = 'Camera placement is on, and so is the rotary.';

const READY_CONTROLLER = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const IDLE_STATUS = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const READY_MACHINE = { statusReport: IDLE_STATUS, alarmCode: null, hasActiveStreamer: false };

// A 20 x 20 mm square placed on the camera picture at X 110-130, Y 150-170.
function squareProject(rotary: RotarySetup | undefined, kind: 'laser' | 'cnc' = 'laser'): Project {
  const base = createProject();
  const points = [
    { x: 110, y: 150 },
    { x: 130, y: 150 },
    { x: 130, y: 170 },
    { x: 110, y: 170 },
  ];
  return {
    ...base,
    device: {
      ...base.device,
      homing: { ...base.device.homing, enabled: true },
      ...(rotary === undefined ? {} : { rotary }),
    },
    ...(kind === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'camera-square',
          source: 'square.svg',
          bounds: { minX: 110, minY: 150, maxX: 130, maxY: 170 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
}

const CURRENT: JobOriginPlacement = {
  startFrom: 'current-position',
  anchor: 'center',
  currentPosition: { x: 120, y: 80 },
};
const USER: JobOriginPlacement = { startFrom: 'user-origin', anchor: 'front-left' };
const VERIFIED: JobOriginPlacement = { startFrom: 'verified-origin', anchor: 'front-left' };
const ABSOLUTE: JobOriginPlacement = { startFrom: 'absolute', anchor: 'front-left' };

// `undefined` is how Start resolves Absolute Coordinates (resolveAbsolute
// returns no jobOrigin), so it is in the matrix beside the explicit value.
const START_FROM: ReadonlyArray<readonly [string, JobOriginPlacement | undefined]> = [
  ['Absolute (as Start resolves it)', undefined],
  ['Absolute (explicit)', ABSOLUTE],
  ['Current Position', CURRENT],
  ['User Origin', USER],
  ['Verified Origin', VERIFIED],
];

function cameraWarnings(project: Project, camera: boolean, origin: JobOriginPlacement | undefined) {
  return demotedPolicyWarnings(
    project,
    { ...READY_MACHINE, cameraPlacementActive: camera },
    origin,
  ).filter((warning) => warning.startsWith(CAMERA_ADVICE));
}

describe('camera placement advice: rotary x camera x Start from (W4-P2-1)', () => {
  describe.each(START_FROM)('Start from %s', (name, origin) => {
    const absolute = origin === undefined || origin.startFrom === 'absolute';

    it('says nothing about the camera while camera placement is off, rotary or not', () => {
      expect(cameraWarnings(squareProject(CHUCK), false, origin)).toEqual([]);
      expect(cameraWarnings(squareProject(undefined), false, origin)).toEqual([]);
    });

    it('keeps the flat-bed advice unchanged without a rotary', () => {
      const warnings = cameraWarnings(squareProject(undefined), true, origin);
      if (absolute) {
        expect(warnings).toEqual([]);
      } else {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`Start from is ${name}.`);
        expect(warnings[0]).toContain(ABSOLUTE_ADVICE);
      }
    });

    it('gives the rotary advice on an active rotary, and never advises Absolute', () => {
      const warnings = cameraWarnings(squareProject(CHUCK), true, origin);
      expect(warnings).toHaveLength(1);
      const [warning] = warnings;
      expect(warning).toContain(ROTARY_LEAD);
      expect(warning).not.toContain(ABSOLUTE_ADVICE);
      if (absolute) {
        expect(warning).toContain('Start from is Absolute Coordinates');
        expect(warning).toContain('starts at work Y 0');
        expect(warning).toContain('Choose Current Position');
      } else {
        expect(warning).toContain(`Keep ${name}, and do not choose Absolute Coordinates`);
      }
    });

    it('treats a rotary that is switched off, or set up on a CNC, as the flat bed', () => {
      const off = cameraWarnings(squareProject({ ...CHUCK, enabled: false }), true, origin);
      const cnc = cameraWarnings(squareProject(CHUCK, 'cnc'), true, origin);
      const flat = cameraWarnings(squareProject(undefined), true, origin);
      expect(off).toEqual(flat);
      expect(cnc).toEqual(flat);
    });
  });

  it('puts the rotary before the Place Board and jig wording, which keep their Start from', () => {
    const latched = { cameraPlacementActive: true };
    for (const layout of ['place-board', 'jig'] as const) {
      expect(cameraPlacementStartFromWarning(latched, USER, layout, true)).toBe(
        rotaryCameraWarning('user-origin'),
      );
      expect(cameraPlacementStartFromWarning(latched, undefined, layout, true)).toBe(
        rotaryCameraWarning('absolute'),
      );
    }
  });

  it('gives a Place Board job on a rotary the rotary advice, not Absolute', () => {
    resetStore();
    useStore.setState({ project: squareProject(CHUCK) });
    useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 100, heightMm: 50 });
    const warnings = cameraWarnings(useStore.getState().project, true, USER);
    expect(warnings).toEqual([rotaryCameraWarning('user-origin')]);
  });
});

function burnYRange(gcode: string): { readonly min: number; readonly max: number } {
  const ys = gcode
    .split('\n')
    .filter((line) => /^G1\b/.test(line) && !/\bS0\b/.test(line))
    .flatMap((line) => {
      const match = /Y(-?\d+(?:\.\d+)?)/.exec(line);
      return match === null ? [] : [Number(match[1])];
    });
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

describe('why Absolute is never advised on a rotary (the audit repro)', () => {
  it('moves the burn from around the cylinder turn to work Y 0', () => {
    const current = burnYRange(emitGcode(squareProject(CHUCK), { jobOrigin: CURRENT }).gcode);
    const absolute = burnYRange(emitGcode(squareProject(CHUCK)).gcode);

    // Current Position at work Y 80: Y 60.9-99.1, around the face set up.
    expect(current.min).toBeCloseTo(80 - 10 * SCALE, 2);
    expect(current.max).toBeCloseTo(80 + 10 * SCALE, 2);
    // Absolute, which the old advice led to: Y 0-38.2, ~60.9 mm of turn away.
    expect(absolute.min).toBeCloseTo(0, 3);
    expect(absolute.max).toBeCloseTo(20 * SCALE, 2);
  });
});

// A rotary Frame traces the machine-space job (required-frame-readiness), so
// its proof is signed from those bounds, not the surface ones.
function rotaryFrameVerification(
  project: Project,
  options: {
    readonly jobOrigin?: JobOriginPlacement;
    readonly wco?: typeof IDLE_STATUS.mPos;
    readonly workOriginActive?: boolean;
  } = {},
): FrameVerification {
  const prepared = prepareOutput(
    project,
    options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin },
  );
  if (!prepared.ok) throw new Error('Expected prepared rotary output');
  const job = machineSpaceJob(prepared.job, prepared.project.device, prepared.project.machine);
  const bounds = computeJobBounds(job, prepared.project.device);
  if (bounds === null) throw new Error('Expected rotary job bounds');
  return {
    boundsSignature: frameBoundsSignature(bounds),
    wco: options.wco ?? null,
    workOriginActive: options.workOriginActive === true,
  };
}

describe('Start on a rotary with camera placement latched (real prepareStartJob)', () => {
  it('warns at Absolute Coordinates, where the old advice went silent', () => {
    const project = squareProject(CHUCK);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'confirmed',
      frameVerification: rotaryFrameVerification(project),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(rotaryCameraWarning('absolute'));
      expect(result.warnings.some((w) => w.includes(ABSOLUTE_ADVICE))).toBe(false);
    }
  });

  it('tells a User Origin job to keep User Origin', () => {
    const project = squareProject(CHUCK);
    const wco = { x: 15, y: 25, z: 0 };
    const result = prepareStartJob(
      project,
      READY_CONTROLLER,
      {
        ...READY_MACHINE,
        cameraPlacementActive: true,
        homingState: 'confirmed',
        workOriginActive: true,
        wcoCache: wco,
        frameVerification: rotaryFrameVerification(project, {
          jobOrigin: USER,
          wco,
          workOriginActive: true,
        }),
      },
      { startFrom: 'user-origin', anchor: 'front-left' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(rotaryCameraWarning('user-origin'));
      expect(result.warnings.some((w) => w.includes(ABSOLUTE_ADVICE))).toBe(false);
    }
  });

  // The refuter's side observation: the camera target compiles at Absolute
  // with placement forced on (transient-camera-job.ts), so a rotary left on
  // rebased the rings to Y 0 with no warning. The target's confirm now lists
  // the rotary warning, which says to switch Rotary off.
  it('warns the camera calibration target when the rotary is left on', async () => {
    const base = squareProject(CHUCK);
    const target = generateCameraBedTarget({
      area: { x: 40, y: 40, width: 120, height: 120 },
      ringDiameterMm: 10,
      power: 20,
      speed: 1000,
    });
    // The project and call engraveCalibrationTarget / runTransientCameraJob make.
    const project: Project = { ...base, machine: { kind: 'laser' }, scene: target.scene };
    const result = await prepareStartJobSnapshot(
      project,
      READY_CONTROLLER,
      { ...READY_MACHINE, cameraPlacementActive: true, homingState: 'confirmed' },
      DEFAULT_JOB_PLACEMENT,
      DEFAULT_OUTPUT_SCOPE,
      { clock: () => new Date(0), renderVariableText, requireFrame: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(rotaryCameraWarning('absolute'));
      expect(rotaryCameraWarning('absolute')).toContain('switch Rotary off beside Start');
    }
  });
});
