// Annoyance audit A2, group G5 (B3-P2-1 and B3-P2-2), on the firmware fakes:
// what a homed Marlin, Smoothieware, grblHAL and FluidNC session gives KerfDesk
// to go on, and what the operator's statement and grblHAL's own `$$` change.
// ADR-095 Amendment 1 and ADR-322 Amendment 4. Simulators only; no machine was
// operated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  createMarlinSimulator,
  createSmoothieSimulator,
} from '../../__fixtures__/controllers';
import { GRBLHAL_LASER_DUMP } from '../../__fixtures__/controllers/grblhal-settings-dump';
import { grblDriver } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import { createOperatorPowerScaleStatement } from '../../core/devices/power-scale-statement';
import { runControllerReadiness } from '../../core/preflight';
import { laserModeStartReview } from '../laser/laser-mode-start-acknowledgement';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import {
  captureLaserModeStartSnapshot,
  laserModeStartSnapshotIsVerified,
} from './laser-mode-start-evidence';
import { useLaserStore } from './laser-store';
import { nativeBedFrameStatus } from './native-bed-frame';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
    homingProof: null,
    lastWriteError: null,
    safetyNotice: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function home(): Promise<void> {
  const done = useLaserStore.getState().home();
  await pump(8_000);
  await done;
  expect(useLaserStore.getState().homingState).toBe('confirmed');
}

const HOMING = { enabled: true, direction: 'front-left' } as const;

function setProfile(patch: Partial<DeviceProfile>): void {
  useStore.getState().updateDeviceProfile({ homing: HOMING, ...patch });
}

function powerScale() {
  const laser = useLaserStore.getState();
  const project = useStore.getState().project;
  const snapshot = captureLaserModeStartSnapshot(laser);
  const readiness = runControllerReadiness(
    project,
    laser.controllerSettings,
    laser.capabilities.settings,
    laser.detectedControllerKind ?? laser.activeControllerKind,
  );
  return {
    verified: laserModeStartSnapshotIsVerified(snapshot, project.device.maxPowerS),
    review: laserModeStartReview(project, snapshot),
    notes: [...readiness.errors, ...readiness.warnings].map((entry) => entry.message),
  };
}

function bedMapping() {
  return nativeBedFrameStatus(useStore.getState().project.device, useLaserStore.getState());
}

function stateThePowerScale(): void {
  const statement = createOperatorPowerScaleStatement(
    useStore.getState().project.device,
    '2026-11-11T10:00:00.000Z',
  );
  if (statement === null) throw new Error('this firmware takes a statement');
  useStore.getState().updateDeviceProfile({ operatorPowerScaleStatement: statement });
}

async function connectMarlin(): Promise<void> {
  const sim = createMarlinSimulator();
  setProfile({
    controllerKind: 'marlin',
    gcodeDialect: { dialectId: 'marlin-inline' },
    maxPowerS: 255,
  });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(3_000);
}

async function connectSmoothie(): Promise<void> {
  const sim = createSmoothieSimulator();
  setProfile({ controllerKind: 'smoothieware', maxPowerS: 1 });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
}

// grblHAL lists its homing passes (`$44`, `$45`) beside the fixture's settings.
const GRBLHAL_SETTINGS = [
  ...GRBLHAL_LASER_DUMP.map((line) => {
    const [id, value] = line.slice(1).split('=');
    return [Number(id), value ?? ''] as const;
  }),
  [44, '4'],
  [45, '3'],
] as const;

async function connectGrblHal() {
  const sim = createGrblSimulator({
    firmware: 'grblhal',
    firmwareBanner: 'GrblHAL 1.1f',
    settings: GRBLHAL_SETTINGS,
  });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grblhal' });
  await pump(1_200);
  return sim;
}

describe.each([
  ['Marlin', connectMarlin, /Marlin does not report its laser power scale/],
  ['Smoothieware', connectSmoothie, /Smoothieware does not report its laser power scale/],
])('B3-P2-1 on the %s fake', (_name, connect, named) => {
  it('reproduces: a homed session reports no settings and can never be verified', async () => {
    await connect();
    await home();
    expect(useLaserStore.getState().capabilities.settings).toBe('none');
    const before = powerScale();
    expect(before.verified).toBe(false);
    expect(before.review?.kind).toBe('unverified');
    // The fix: its own words, with no GRBL setting it does not have.
    expect(before.notes).toHaveLength(1);
    expect(before.notes[0]).toMatch(named);
    const prompt = before.review?.kind === 'unverified' ? before.review.prompt : '';
    expect(prompt).toMatch(named);
    expect(`${prompt}\n${before.notes.join('\n')}`).not.toMatch(/\$3[0-2]|GRBL/);
  });

  it('after the operator states the scale: no question, no note, still not verified', async () => {
    await connect();
    stateThePowerScale();
    const after = powerScale();
    expect(after.verified).toBe(false);
    expect(after.review?.kind).toBe('operator-stated');
    expect(after.notes).toEqual([]);

    // A different Full-power S voids it through the ordinary profile edit.
    useStore.getState().updateDeviceProfile({ maxPowerS: 100 });
    expect(useStore.getState().project.device.operatorPowerScaleStatement).toBeUndefined();
    expect(powerScale().review?.kind).toBe('unverified');
  });
});

describe('B3-P2-1 does not reach FluidNC', () => {
  it('refuted for FluidNC: its settings report carries $30 and $32, so it verifies', async () => {
    const sim = createGrblSimulator({ firmwareBanner: "Grbl 3.7 [FluidNC v3.7.8 '$' for help]" });
    setProfile({ controllerKind: 'fluidnc', maxPowerS: 1000 });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'fluidnc' });
    await pump(1_200);
    expect(useLaserStore.getState().capabilities.settings).toBe('readonly-dump');
    expect(powerScale()).toMatchObject({ verified: true, review: { kind: 'verified' } });
  });
});

describe('B3-P2-2 on the firmware fakes', () => {
  it.each([
    ['Marlin', connectMarlin, 'marlin'],
    ['Smoothieware', connectSmoothie, 'smoothieware'],
  ])('a homed %s has no bed mapping, and the reason names it', async (_name, connect, kind) => {
    await connect();
    await home();
    expect(bedMapping()).toEqual({ frame: null, reason: { kind: 'firmware', firmware: kind } });
  });

  it('a homed FluidNC has no bed mapping: $$ does not carry mpos_mm', async () => {
    const sim = createGrblSimulator({ firmwareBanner: "Grbl 3.7 [FluidNC v3.7.8 '$' for help]" });
    setProfile({ controllerKind: 'fluidnc', bedWidth: 400, bedHeight: 400 });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'fluidnc' });
    await pump(1_200);
    await home();
    expect(bedMapping()).toEqual({
      frame: null,
      reason: { kind: 'firmware', firmware: 'fluidnc' },
    });
  });

  it('a grblHAL earns the mapping from its own settings once it is homed', async () => {
    setProfile({ controllerKind: 'grblhal', bedWidth: 396, bedHeight: 296 });
    await connectGrblHal();
    expect(bedMapping().reason).toEqual({ kind: 'not-homed' });
    await home();
    expect(bedMapping()).toMatchObject({
      reason: null,
      frame: { nativeBounds: { minX: -398, maxX: -2, minY: -298, maxY: -2 } },
    });
  });

  it('a grblHAL bed that is the raw travel is named, not mapped', async () => {
    setProfile({ controllerKind: 'grblhal', bedWidth: 400, bedHeight: 300 });
    await connectGrblHal();
    await home();
    expect(bedMapping()).toEqual({
      frame: null,
      reason: { kind: 'bed-differs', homedArea: { widthMm: 396, heightMm: 296 } },
    });
  });

  it('the grblHAL mapping goes with the Home: an alarm clears it', async () => {
    setProfile({ controllerKind: 'grblhal', bedWidth: 396, bedHeight: 296 });
    const sim = await connectGrblHal();
    await home();
    expect(bedMapping().frame).not.toBeNull();

    sim.triggerAlarm(1);
    await pump(50);
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
    expect(bedMapping()).toEqual({ frame: null, reason: { kind: 'not-homed' } });
  });

  it('the grblHAL mapping goes with the Home: a reset clears it', async () => {
    setProfile({ controllerKind: 'grblhal', bedWidth: 396, bedHeight: 296 });
    await connectGrblHal();
    await home();
    expect(bedMapping().frame).not.toBeNull();

    const stopped = useLaserStore.getState().stopJob();
    await pump(3_000);
    await stopped;
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
    expect(bedMapping().frame).toBeNull();
  });

  it('the grblHAL mapping goes with the Home: a reconnect clears it', async () => {
    setProfile({ controllerKind: 'grblhal', bedWidth: 396, bedHeight: 296 });
    await connectGrblHal();
    await home();
    expect(bedMapping().frame).not.toBeNull();

    await disconnectOnTestClock();
    expect(bedMapping().frame).toBeNull();
    await connectGrblHal();
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
    expect(bedMapping()).toEqual({ frame: null, reason: { kind: 'not-homed' } });
  });
});
