// Controller audit SM-3 and SM-2: qualification asks Smoothieware `M221` (no
// argument) whether its Laser module is loaded and whether it has M221 P.
//
// SM-3: the Laser module deletes itself unless laser_module_enable is true and
// its pin is a hardware-PWM pin (Laser.cpp L51-L74), and nothing else answers
// `fire` (SimpleShell.cpp L286-L288; GcodeDispatch ignores lowercase lines,
// L79-L82). Every jog, Frame tool-off prefix, Home and job used to start with
// `fire off`, so each one stranded an owed acknowledgement forever.
// SM-2: before 971eb8cf (2021-06-15) M221 had no P word and every burn was
// speed-proportional; that build answers `Laser power scale at …` instead of
// `Laser power: …, disable auto power: …` (Laser.cpp L198-L202).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L51-L74

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { LASER_MODULE_ABSENT_MESSAGE } from '../../core/preflight/laser-module-readiness';
import { SMOOTHIE_NO_LASER_MODULE_FIRE_REASON } from '../../core/controllers/smoothieware/laser-module';
import type { FramedRunCandidate } from './framed-run';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
    lastWriteError: null,
    safetyNotice: null,
    laserModuleEvidence: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectSmoothie(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator(options);
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function settled<T>(promise: Promise<T>): Promise<string> {
  return promise.then(
    () => 'done',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe('SM-3: a Smoothieware board without the Laser module', () => {
  it('is recognised at qualification from the M221 reply', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    const state = useLaserStore.getState();
    expect(sim.outbound().filter((line) => line === 'M221\n')).toHaveLength(1);
    expect(state.laserModuleEvidence).toMatchObject({ module: 'absent', constantPowerMode: null });
    expect(state.controllerQualification).toMatchObject({ kind: 'qualified' });
    expect(state.pendingUntrackedAcks).toBe(0);
  });

  it('jogs without `fire off` and leaves Home usable (no acknowledgement owed)', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    await useLaserStore
      .getState()
      .jog({ dx: 5, feed: 1_000 })
      .catch(() => undefined);
    await pump(10_000);
    expect(sim.state()).toMatchObject({ pos: { x: 5 }, machine: 'Idle' });
    expect(sim.outbound().some((line) => line.includes('fire'))).toBe(false);

    const owed = useLaserStore.getState().pendingUntrackedAcks;
    const home = settled(useLaserStore.getState().home());
    await pump(5_000);
    expect({ owed, home: await home }).toEqual({ owed: 0, home: 'done' });
  });

  it('homes by itself: the tool-off prefix no longer stalls on `fire off`', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    const home = settled(useLaserStore.getState().home());
    await pump(5_000);
    expect({
      outcome: await home,
      homingCycles: sim.state().homingCycles,
      owed: useLaserStore.getState().pendingUntrackedAcks,
    }).toEqual({ outcome: 'done', homingCycles: 1, owed: 0 });
  });

  it('refuses a laser job with the factual reason and sends none of its bytes', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    const written = sim.outbound().length;
    const start = settled(startTestLaserJob('fire off\nG1 X10 F600 S0.5\n'));
    await pump(2_000);
    expect(await start).toContain(LASER_MODULE_ABSENT_MESSAGE);
    expect(
      sim
        .outbound()
        .slice(written)
        .some((line) => line.includes('G1 X10')),
    ).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it("refuses a laser job's Frame, but not a plain Frame of an area", async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    const project = useStore.getState().project;
    const candidate = { project } as unknown as FramedRunCandidate;
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const jobFrame = settled(useLaserStore.getState().frame(bounds, 1_000, candidate));
    await pump(2_000);
    expect(await jobFrame).toBe(LASER_MODULE_ABSENT_MESSAGE);

    const plainFrame = settled(useLaserStore.getState().frame(bounds, 1_000));
    await pump(10_000);
    expect(await plainFrame).toBe('done');
    expect(sim.outbound().some((line) => line.includes('fire'))).toBe(false);
  });

  it('checks the module again when the board reboots (boot banner)', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    sim.port.emitLine('Smoothie Running @120MHz');
    await pump(3_000);
    const state = useLaserStore.getState();
    expect(sim.outbound().filter((line) => line === 'M221\n')).toHaveLength(2);
    expect(state.laserModuleEvidence).toMatchObject({
      module: 'absent',
      sessionEpoch: state.controllerSessionEpoch,
    });
    expect(state.controllerQualification).toMatchObject({
      kind: 'qualified',
      epoch: state.controllerSessionEpoch,
    });
    expect(state.controllerOperation).toBeNull();
  });

  it('refuses `fire off` from the Console', async () => {
    const sim = await connectSmoothie({ laserModule: 'absent' });
    await expect(useLaserStore.getState().sendConsoleCommand('fire off')).rejects.toThrow(
      SMOOTHIE_NO_LASER_MODULE_FIRE_REASON,
    );
    expect(sim.outbound()).not.toContain('fire off\n');
  });
});

describe('SM-2 and the controls: Smoothieware boards with the Laser module', () => {
  it('records a pre-2021-06-15 build as having no constant-power mode', async () => {
    await connectSmoothie({ laserModule: 'pre-2021' });
    expect(useLaserStore.getState().laserModuleEvidence).toMatchObject({
      module: 'loaded',
      constantPowerMode: false,
    });
  });

  it('keeps `fire off` and constant power on the current edge build', async () => {
    const sim = await connectSmoothie();
    expect(useLaserStore.getState().laserModuleEvidence).toMatchObject({
      module: 'loaded',
      constantPowerMode: true,
    });
    await useLaserStore.getState().jog({ dx: 5, feed: 1_000 });
    await pump(1_000);
    const jog = sim.outbound().find((line) => line.includes('G91'));
    expect(jog?.startsWith('fire off\n')).toBe(true);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});
