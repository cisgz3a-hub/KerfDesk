// Regression tests for audit findings jog-home-origin-1 / status-1 (a jog or
// Frame line the controller rejects wedged the motion owner and silenced status
// polling) and job-lifecycle-5 (a Cancel that timed out did the same).
//
// The oracle is the simulated firmware plus what the operator can see: GRBL
// rejects an out-of-travel jog before planning it (jog.c jog_execute() returns
// STATUS_TRAVEL_EXCEEDED ahead of mc_line(),
// https://github.com/gnea/grbl/blob/master/grbl/jog.c), so the simulator stays
// Idle at its old position; the tests then read the wire (status polls, the
// settle marker, no reset byte) and the store's refusals.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore, type ConnectControllerOptions } from './laser-store';
import { jogFrameCommandBlockMessage, setupCommandBlockMessage } from './laser-store-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const GRBL_HAL_BANNER = "GrblHAL 1.1f ['$' or '$HELP' for help]";
const SOFT_RESET = '\x18';
const JOG_CANCEL = '\x85';
const SETTLE_MARKER = 'G4 P0.01\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    frameVerification: null,
    framedRun: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectIdle(
  options: CreateGrblSimulatorOptions,
  connectOptions: ConnectControllerOptions = {},
): Promise<GrblSimulator> {
  const sim = createGrblSimulator(options);
  await useLaserStore.getState().connect(sim.adapter, connectOptions);
  await pump(1_120);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().motionOperation).toBeNull();
  return sim;
}

function writesSince(sim: GrblSimulator, index: number): ReadonlyArray<string> {
  return sim.outbound().slice(index);
}

function operatorCanMoveAgain(): { owner: unknown; jogFrame: unknown; setup: unknown } {
  const state = useLaserStore.getState();
  return {
    owner: state.motionOperation,
    jogFrame: jogFrameCommandBlockMessage(state),
    setup: setupCommandBlockMessage(state),
  };
}

const RELEASED = { owner: null, jogFrame: null, setup: null };

describe('a motion line the controller rejects releases its owner once the machine is Idle', () => {
  it.each([
    ['GRBL 1.1', {}, {}],
    ['grblHAL', { firmwareBanner: GRBL_HAL_BANNER }, { controllerKind: 'grblhal' as const }],
  ])('%s: a step jog refused with error:15 (soft limit)', async (_label, simOptions, connect) => {
    const sim = await connectIdle(
      {
        motionMs: 200,
        rejectLines: [{ pattern: /^\$J=G91 G21 X10\.000/, errorCode: 15 }],
        ...simOptions,
      },
      connect,
    );
    const before = sim.outbound().length;

    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    await pump(20);
    expect(useLaserStore.getState().lastError).toBe(15);
    // The firmware planned nothing: still Idle where it was.
    expect(sim.state().machine).toBe('Idle');
    expect(sim.state().mpos.x).toBe(0);

    await pump(3_000);
    const after = writesSince(sim, before);
    expect(operatorCanMoveAgain()).toEqual(RELEASED);
    // Status polling kept running, the release crossed the ack-owned settle
    // marker exactly once, and nothing reset or cancelled the controller.
    expect(after.filter((write) => write === '?').length).toBeGreaterThan(2);
    expect(after.filter((write) => write === SETTLE_MARKER)).toHaveLength(1);
    expect(after).not.toContain(SOFT_RESET);
    expect(after).not.toContain(JOG_CANCEL);

    // The operator can jog back without ABORT MOTION or a reconnect.
    await useLaserStore.getState().jog({ dx: -10, feed: 1000 });
    expect(sim.outbound()).toContain('$J=G91 G21 X-10.000 F1000\n');
  });

  it('a Frame whose second perimeter leg is refused sends no further legs and mints no permit', async () => {
    const sim = await connectIdle({
      motionMs: 50,
      rejectLines: [{ pattern: /^\$J=G90 G21 X20\.000 Y0\.000/, errorCode: 15 }],
    });
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 6000);
    await pump(3_000);

    const legs = sim.outbound().filter((write) => write.startsWith('$J=G90'));
    expect(legs).toEqual(['$J=G90 G21 X0.000 Y0.000 F6000\n', '$J=G90 G21 X20.000 Y0.000 F6000\n']);
    expect(useLaserStore.getState().lastError).toBe(15);
    expect(operatorCanMoveAgain()).toEqual(RELEASED);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(sim.outbound()).not.toContain(SOFT_RESET);
  });

  it('keeps the owner while the rejected write still owes its acknowledgement', async () => {
    const sim = await connectIdle({ motionMs: 200 });
    // A transport failure is ambiguous: the controller may still answer the
    // line, so its FIFO acknowledgement stays reserved (laser-safe-write).
    useLaserStore.setState({
      pendingUntrackedAcks: 1,
      motionOperation: {
        operationId: Symbol('quarantined-jog'),
        kind: 'jog',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [SETTLE_MARKER],
        cancelRequested: true,
      },
    });
    const before = sim.outbound().length;
    await pump(3_000);

    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
    expect(writesSince(sim, before)).not.toContain(SETTLE_MARKER);
    // Background polling is not silenced by a cancelled owner.
    expect(writesSince(sim, before).filter((write) => write === '?').length).toBeGreaterThan(2);
  });
});

describe('a Cancel that gives up does not wedge the motion owner', () => {
  it('Falcon: a G1 leg longer than the cancel deadline is released once it ends', async () => {
    useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
    // Each planner block takes 12 s, longer than Cancel's 8 s deadline, and the
    // Falcon command set has no jog-cancel byte to stop it.
    const sim = createGrblSimulator({ motionMs: 12_000 });
    await useLaserStore
      .getState()
      .connect(sim.adapter, connectOptionsForDevice(FALCON_A1_PRO_GRBLHAL_PROFILE));
    await pump(1_100);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    const jog = useLaserStore
      .getState()
      .jog({ dx: 100, feed: 500 })
      .catch(() => undefined);
    await pump(600);
    await jog;
    const cancel = useLaserStore
      .getState()
      .cancelJog()
      .then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await pump(9_000);
    const cancelError = await cancel;
    // The failure names what the operator can do; Reconnect is disabled while
    // a motion owner exists.
    expect(cancelError).toMatch(/releases motion control when the controller next reports Idle/);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });

    await pump(15_000);
    expect(sim.state().machine).toBe('Idle');
    expect(sim.state().mpos.x).toBe(100);
    expect(operatorCanMoveAgain()).toEqual(RELEASED);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(sim.outbound()).not.toContain(SOFT_RESET);
  });
});
