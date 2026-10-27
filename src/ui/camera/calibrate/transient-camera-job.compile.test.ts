// Rolling audit v4 H1-P1-1 (ADR-440 Amendment 7): Engrave target and the
// nudge ring compile for real here, against the same connected GRBL a canvas
// Start sees. Only the controller queue, the physical Frame and the dialogs
// are stubbed; the program, its Frame rectangle and its S words are the ones
// the machine would get.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { generateCameraNudgeRing } from '../../../core/job/camera-bed-target-pattern';
import { createProject } from '../../../core/scene';
import type { ConfirmedJobReview } from '../../laser/job-review';
import { prepareCurrentStartJob } from '../../laser/start-job-source';
import type { StartJobPreparation } from '../../laser/start-job-readiness';
import {
  dispatchTransientReviewedFrame,
  prepareTransientFrameController,
} from '../../laser/use-frame-action';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { UNKNOWN_NATIVE_BED_MESSAGE } from '../../state/native-bed-frame';
import { stockNativeEvidence } from '../../state/native-bed-frame.test-support';
import { addCalibrationTargetToCanvas, engraveCalibrationTarget } from './calibration-actions';
import { DEFAULT_CALIBRATION_SETTINGS } from './camera-calibration-store';
import { engraveNudgeRing, nudgeRingCentre } from './nudge-actions';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

vi.mock('../../laser/use-frame-action', () => ({
  dispatchTransientReviewedFrame: vi.fn(),
  prepareTransientFrameController: vi.fn(),
}));

type Prepared = Extract<StartJobPreparation, { readonly ok: true }>;
type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const PROFILE_MAX_S = 1000;
const CONTROLLER_MAX_S = 255;
// 35% (the wizard's default ring power) of the connected $30=255.
const RING_S = Math.round((DEFAULT_CALIBRATION_SETTINGS.powerPercent / 100) * CONTROLLER_MAX_S);

const machines = [
  // Stock GRBL sets its position from a negative max travel after homing.
  { name: 'stock GRBL homing back-right ($23=0)', forceOrigin: false, direction: 0, travel: -1 },
  { name: 'stock GRBL homing front-left ($23=3)', forceOrigin: false, direction: 3, travel: -1 },
  // HOMING_FORCE_SET_ORIGIN at the bed origin: native and bed coordinates agree.
  {
    name: 'force-origin GRBL homing front-left ($23=3)',
    forceOrigin: true,
    direction: 3,
    travel: 1,
  },
] as const;

let captured: ConfirmedJobReview | null = null;

beforeEach(() => {
  captured = null;
  const base = createProject();
  // Opening a file for the machine in use keeps its setup (ADR-500 Amendment
  // 2), so the machine is set in the profile, as the operator would.
  useStore.getState().setProject(base);
  useStore.getState().updateDeviceProfile({
    origin: 'front-left',
    bedWidth: 400,
    bedHeight: 400,
    maxPowerS: PROFILE_MAX_S,
    homing: { ...base.device.homing, enabled: true },
  });
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  vi.mocked(prepareTransientFrameController).mockImplementation(async () => ({
    laser: useLaserStore.getState(),
  }));
  // Capture what would be framed, and frame nothing.
  vi.mocked(dispatchTransientReviewedFrame).mockImplementation(async (review) => {
    captured = review;
    return null;
  });
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

function connectHomedGrbl(machine: (typeof machines)[number]): void {
  const evidence = stockNativeEvidence(
    useStore.getState().project.device,
    machine.forceOrigin,
    machine.direction,
  );
  const status: StatusReport = {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: { x: 0, y: 0, z: 0 },
  };
  useLaserStore.setState((state) => ({
    ...initialLaserState(),
    ...evidence,
    controllerSettings: { ...evidence.controllerSettings, maxPowerS: CONTROLLER_MAX_S },
    connection: { kind: 'connected' },
    statusReport: status,
    wcoCache: status.wco,
    capabilities: { ...state.capabilities, settings: 'grbl-dollar' },
  }));
}

function transientPrepared(): Prepared {
  const prepared = captured?.bundle.prepared;
  if (prepared === undefined || !prepared.ok) throw new Error('Expected a reviewed camera job');
  return prepared;
}

async function canvasStart(): Promise<Prepared> {
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(`Canvas Start refused: ${prepared.messages.join(' ')}`);
  return prepared;
}

function frameOf(prepared: Prepared): Bounds {
  const bounds = prepared.metrics.frameMotionBounds ?? prepared.metrics.frameJobBounds;
  if (bounds === null) throw new Error('Expected a Frame');
  return bounds;
}

function powerWords(gcode: string): ReadonlyArray<number> {
  const words = gcode
    .split('\n')
    .flatMap((line) => [...(line.split(';')[0] ?? '').matchAll(/S(\d+(?:\.\d+)?)/g)])
    .map((match) => Number(match[1]))
    .filter((power) => power > 0);
  return [...new Set(words)];
}

function expectInsideTravel(frame: Bounds, sign: -1 | 1): void {
  const [low, high] = sign < 0 ? [-400, 0] : [0, 400];
  expect(frame.minX).toBeGreaterThanOrEqual(low);
  expect(frame.maxX).toBeLessThanOrEqual(high);
  expect(frame.minY).toBeGreaterThanOrEqual(low);
  expect(frame.maxY).toBeLessThanOrEqual(high);
}

function confirmedText(): string {
  return vi
    .mocked(jobAwareConfirm)
    .mock.calls.map(([message]) => message)
    .join('\n');
}

// Each case compiles the ring target twice for real, which takes several
// seconds on a busy machine (the default 5 s timed out under load).
const COMPILE_TIMEOUT = { timeout: 60_000 };

describe('Engrave target compiles as a canvas Start of the same rings', COMPILE_TIMEOUT, () => {
  it.each(machines)('$name, controller S max 255 under a profile S1000', async (machine) => {
    connectHomedGrbl(machine);

    await expect(engraveCalibrationTarget(DEFAULT_CALIBRATION_SETTINGS)).resolves.toBe(false);
    const transient = transientPrepared();
    addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS);
    const canvas = await canvasStart();

    expect(transient.gcode).toBe(canvas.gcode);
    expect(frameOf(transient)).toEqual(frameOf(canvas));
    expectInsideTravel(frameOf(transient), machine.travel);
    expect(powerWords(transient.gcode)).toEqual([RING_S]);
    expect(transient.laserPowerScale).toEqual({
      maxPowerS: CONTROLLER_MAX_S,
      source: 'controller',
      controllerSessionEpoch: 7,
    });
    expect(transient.warnings).toEqual(canvas.warnings);
    // The session proved the mapping: the generic "unverified" warning is false here.
    expect(confirmedText()).not.toContain(UNKNOWN_NATIVE_BED_MESSAGE);
    expect(confirmedText()).not.toContain('no current controller power range was verified');
  });
});

describe('The nudge ring compiles as a canvas Start of the same ring', COMPILE_TIMEOUT, () => {
  it.each(machines.slice(0, 1))(
    '$name, controller S max 255 under a profile S1000',
    async (machine) => {
      connectHomedGrbl(machine);

      await expect(engraveNudgeRing(DEFAULT_CALIBRATION_SETTINGS)).resolves.toBe(false);
      const transient = transientPrepared();
      const store = useStore.getState();
      store.replaceSceneWithGeneratedScene(
        generateCameraNudgeRing({
          centre: nudgeRingCentre(),
          ringDiameterMm: DEFAULT_CALIBRATION_SETTINGS.ringDiameterMm,
          power: DEFAULT_CALIBRATION_SETTINGS.powerPercent,
          speed: DEFAULT_CALIBRATION_SETTINGS.speedMmPerMin,
        }),
      );
      store.setJobPlacement({ startFrom: 'absolute' });
      const canvas = await canvasStart();

      expect(transient.gcode).toBe(canvas.gcode);
      // The bed centre (200, 200) is native (-200, -200) on this machine.
      const frame = frameOf(transient);
      expect((frame.minX + frame.maxX) / 2).toBeCloseTo(-200, 1);
      expect((frame.minY + frame.maxY) / 2).toBeCloseTo(-200, 1);
      expectInsideTravel(frame, machine.travel);
      expect(powerWords(transient.gcode)).toEqual([RING_S]);
    },
  );
});
