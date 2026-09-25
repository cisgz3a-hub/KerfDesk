import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, marlinDriver } from '../../core/controllers';
import type { JogParams } from '../../core/controllers/grbl';
import { DEFAULT_ROTARY_SETUP, type RotarySetup } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { MANUAL_MOTION_CANCELLED_MESSAGE } from '../state/manual-motion-intent';
import {
  planRotaryTestRotation,
  rotaryTestBlockReason,
  runRotaryTestRotation,
  stopRotaryTestMotion,
  type RotaryTestPhase,
} from './rotary-test-rotation';

const ROLLER: RotarySetup = { ...DEFAULT_ROTARY_SETUP, enabled: true, objectDiameterMm: 60 };
const MEASURED_ROLLER: RotarySetup = { ...ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 };
const CHUCK: RotarySetup = { ...ROLLER, type: 'chuck', mmPerRotation: 360 };

function idleReport() {
  return {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

function readyLaser(): void {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    capabilities: grblDriver.capabilities,
    statusReport: idleReport(),
  });
}

// A jog double on the real store: each call installs one jog owner, and the
// test settles it the way the store would (released, or cancelled first).
function installFakeJog() {
  const calls: JogParams[] = [];
  const jog = vi.fn(async (params: JogParams) => {
    calls.push(params);
    useLaserStore.setState({
      motionOperation: {
        kind: 'jog',
        operationId: Symbol('jog'),
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });
  });
  useLaserStore.setState({ jog });
  return {
    calls,
    jog,
    release: () => useLaserStore.setState({ motionOperation: null }),
    cancelThenRelease: () => {
      const operation = useLaserStore.getState().motionOperation;
      if (operation === null) throw new Error('No jog to cancel');
      useLaserStore.setState({ motionOperation: { ...operation, cancelRequested: true } });
      useLaserStore.setState({ motionOperation: null });
    },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

beforeEach(readyLaser);

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

describe('planRotaryTestRotation', () => {
  it('turns a surface-calibrated roller object once at a pace of about ten seconds', () => {
    const plan = planRotaryTestRotation(ROLLER, 'object', 6000);
    if (plan === null) throw new Error('Expected a plan');
    const circumference = Math.PI * 60;
    expect(plan.travelMm).toBeCloseTo(circumference, 9);
    expect(plan.feedMmPerMin).toBe(Math.round(circumference * 6));
    expect(plan.legSeconds).toBeCloseTo(10, 1);
    expect(plan.legs).toEqual([
      { dy: plan.travelMm, feed: plan.feedMmPerMin },
      { dy: -plan.travelMm, feed: plan.feedMmPerMin },
    ]);
    // Without a roller diameter nothing knows how far one roller turn is.
    expect(planRotaryTestRotation(ROLLER, 'drive', 6000)).toBeNull();
  });

  it('turns a measured roller once, or the object once through the roller ratio', () => {
    expect(planRotaryTestRotation(MEASURED_ROLLER, 'drive', 6000)?.travelMm).toBe(40);
    expect(planRotaryTestRotation(MEASURED_ROLLER, 'object', 6000)?.travelMm).toBeCloseTo(96, 9);
  });

  it('keeps the feed slow, above a floor, and within the profile maximum', () => {
    expect(planRotaryTestRotation(CHUCK, 'drive', 6000)?.feedMmPerMin).toBe(1500);
    expect(
      planRotaryTestRotation({ ...ROLLER, objectDiameterMm: 2 }, 'object', 6000),
    ).toMatchObject({ feedMmPerMin: 100 });
    expect(planRotaryTestRotation(CHUCK, 'drive', 800)?.feedMmPerMin).toBe(800);
  });

  it('refuses a setup without a usable revolution', () => {
    expect(planRotaryTestRotation({ ...CHUCK, mmPerRotation: 0 }, 'drive', 6000)).toBeNull();
    expect(
      planRotaryTestRotation({ ...ROLLER, objectDiameterMm: Number.NaN }, 'object', 6000),
    ).toBeNull();
  });
});

describe('rotaryTestBlockReason', () => {
  it('is ready on a connected, Idle laser controller', () => {
    expect(rotaryTestBlockReason(useLaserStore.getState(), 'laser')).toBeNull();
  });

  it.each<[string, () => void, RegExp]>([
    [
      'disconnected',
      () => useLaserStore.setState({ connection: { kind: 'disconnected' } }),
      /Connect/,
    ],
    [
      'no jog command',
      () => useLaserStore.setState({ capabilities: { ...grblDriver.capabilities, jog: 'none' } }),
      /no jog command/,
    ],
    ['Fire on', () => useLaserStore.setState({ fireActive: true }), /Fire off first/],
    ['auto-focus', () => useLaserStore.setState({ autofocusBusy: true }), /Auto-focus/],
    ['alarm', () => useLaserStore.setState({ alarmCode: 9 }), /alarm/],
    [
      'not Idle',
      () => useLaserStore.setState({ statusReport: { ...idleReport(), state: 'Run' } }),
      /must be Idle/,
    ],
    ['unknown status', () => useLaserStore.setState({ statusReport: null }), /not known yet/],
  ])('blocks when %s', (_name, arrange, message) => {
    arrange();
    expect(rotaryTestBlockReason(useLaserStore.getState(), 'laser')).toMatch(message);
  });

  it('blocks CNC projects, which never apply the rotary mapping', () => {
    expect(rotaryTestBlockReason(useLaserStore.getState(), 'cnc')).toMatch(/laser rotary/);
  });
});

describe('runRotaryTestRotation', () => {
  const plan = () => {
    const result = planRotaryTestRotation(MEASURED_ROLLER, 'drive', 6000);
    if (result === null) throw new Error('Expected a plan');
    return result;
  };

  it('turns out, pauses, then turns back by the same distance', async () => {
    vi.useFakeTimers();
    try {
      const fake = installFakeJog();
      const phases: RotaryTestPhase[] = [];
      const running = runRotaryTestRotation({
        plan: plan(),
        signal: new AbortController().signal,
        onPhase: (phase) => phases.push(phase),
      });
      await flush();
      expect(fake.calls).toEqual([{ dy: 40, feed: 240 }]);
      fake.release();
      await flush();
      expect(phases).toEqual(['turning', 'pausing']);
      await vi.advanceTimersByTimeAsync(999);
      expect(fake.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.calls).toEqual([
        { dy: 40, feed: 240 },
        { dy: -40, feed: 240 },
      ]);
      fake.release();
      await expect(running).resolves.toEqual({ kind: 'done' });
      expect(phases).toEqual(['turning', 'pausing', 'returning']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends no return turn after the operator stops the first', async () => {
    const fake = installFakeJog();
    const controller = new AbortController();
    const running = runRotaryTestRotation({ plan: plan(), signal: controller.signal, pauseMs: 0 });
    await flush();
    controller.abort();
    await expect(running).resolves.toEqual({ kind: 'stopped' });
    fake.release();
    await flush();
    expect(fake.calls).toHaveLength(1);
  });

  it('sends no return turn when the first ends early', async () => {
    const fake = installFakeJog();
    const running = runRotaryTestRotation({
      plan: plan(),
      signal: new AbortController().signal,
      pauseMs: 0,
    });
    await flush();
    fake.cancelThenRelease();
    const outcome = await running;
    expect(outcome.kind).toBe('failed');
    expect(fake.calls).toHaveLength(1);
  });

  it('reports a refused turn and sends nothing more', async () => {
    const jog = vi.fn(async () => {
      throw new Error('Machine must be Idle before jogging or framing (currently Alarm).');
    });
    useLaserStore.setState({ jog });
    const outcome = await runRotaryTestRotation({
      plan: plan(),
      signal: new AbortController().signal,
      pauseMs: 0,
    });
    expect(outcome).toEqual({
      kind: 'failed',
      message: 'Machine must be Idle before jogging or framing (currently Alarm).',
    });
    expect(jog).toHaveBeenCalledTimes(1);
  });

  it('treats a cancel from another surface before the turn starts as a stop', async () => {
    const jog = vi.fn(async () => {
      throw new Error(MANUAL_MOTION_CANCELLED_MESSAGE);
    });
    useLaserStore.setState({ jog });
    const outcome = await runRotaryTestRotation({
      plan: plan(),
      signal: new AbortController().signal,
      pauseMs: 0,
    });
    expect(outcome).toEqual({ kind: 'stopped' });
    expect(jog).toHaveBeenCalledTimes(1);
  });

  it('does not turn back while momentary Fire holds the beam on', async () => {
    const fake = installFakeJog();
    const running = runRotaryTestRotation({
      plan: plan(),
      signal: new AbortController().signal,
      pauseMs: 0,
    });
    await flush();
    useLaserStore.setState({ fireActive: true });
    fake.release();
    const outcome = await running;
    expect(outcome).toMatchObject({ kind: 'failed', message: expect.stringMatching(/Fire/) });
    expect(fake.calls).toHaveLength(1);
  });

  it('does not turn back after an alarm ends the first turn', async () => {
    const fake = installFakeJog();
    const running = runRotaryTestRotation({
      plan: plan(),
      signal: new AbortController().signal,
      pauseMs: 0,
    });
    await flush();
    useLaserStore.setState({ alarmCode: 1, motionOperation: null });
    await expect(running).resolves.toEqual({
      kind: 'failed',
      message: 'The controller reported an alarm during the rotation.',
    });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('stopRotaryTestMotion', () => {
  it('cancels the jog where the firmware has jog cancel', async () => {
    const cancelJog = vi.fn(async () => undefined);
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ cancelJog, stopJob });
    installFakeJog();
    await useLaserStore.getState().jog({ dy: 5, feed: 100 });
    await stopRotaryTestMotion(useLaserStore.getState());
    expect(cancelJog).toHaveBeenCalledTimes(1);
    expect(stopJob).not.toHaveBeenCalled();
  });

  it('aborts motion without jog cancel, and poisons a turn not yet moving', async () => {
    const cancelJog = vi.fn(async () => undefined);
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ cancelJog, stopJob, capabilities: marlinDriver.capabilities });
    await stopRotaryTestMotion(useLaserStore.getState());
    expect(cancelJog).toHaveBeenCalledTimes(1);
    installFakeJog();
    await useLaserStore.getState().jog({ dy: 5, feed: 100 });
    await stopRotaryTestMotion(useLaserStore.getState());
    expect(stopJob).toHaveBeenCalledTimes(1);
  });
});
