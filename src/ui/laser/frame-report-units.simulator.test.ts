import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  createSmoothieSimulator,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startTestLaserJob } from '../state/laser-test-start-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  cancelOwnedFramePreparation,
  useFramePreparationStore,
} from '../state/frame-preparation-store';
import { runFrameNow, prepareTransientFrameController } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  const base = createProject();
  useStore.setState({
    project: { ...base, device: { ...base.device, controllerKind: 'smoothieware', maxPowerS: 1 } },
  });
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});
afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

type Fault =
  | 'none'
  | 'reject'
  | 'no-ack'
  | 'no-report'
  | 'run-report'
  | 'stale-only'
  | 'incomplete';

/** The firmware simulator owns motion. This adapter only faults delivery of
 * G21's terminal reply and its later status, independently of app logic. */
function faultAdapter(sim: SmoothieSimulator) {
  let fault: Fault = 'none';
  let g21Pending = false;
  let afterG21 = false;
  const decorate = (inner: SerialConnection): SerialConnection => ({
    ...inner,
    write: async (data) => {
      if (data === 'G21\n') {
        g21Pending = true;
        if (fault === 'reject') {
          setTimeout(() => sim.port.emitLine('error:Unsupported G21'), 5);
          return;
        }
        if (fault === 'stale-only') {
          // Old inches arrive before G21's ACK. They cannot satisfy the fresh
          // post-ACK report requirement, even though they report Idle.
          sim.port.emitLine('<Idle|MPos:10,5,0|WPos:10,5,0>');
        }
      }
      await inner.write(data);
    },
    onLine: (handler) =>
      inner.onLine((line) => {
        if (g21Pending && /^ok\b/.test(line)) {
          if (fault === 'no-ack') return;
          g21Pending = false;
          afterG21 = true;
        }
        if (afterG21 && line.startsWith('<')) {
          if (fault === 'no-report' || fault === 'stale-only') return;
          if (fault === 'run-report') line = line.replace(/^<Idle/, '<Run');
          if (fault === 'incomplete') line = '<Idle|MPos:254,127,0>';
        }
        handler(line);
      }),
  });
  const adapter: PlatformAdapter = {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async () => {
        const port = await sim.adapter.serial.requestPort();
        return port === null
          ? null
          : { ...port, open: async (options) => decorate(await port.open(options)) };
      },
    },
  };
  return {
    adapter,
    arm: (value: Fault) => {
      fault = value;
    },
  };
}

async function connectFaulted(fault: Fault) {
  const sim = createSmoothieSimulator({ motionMs: 25 });
  const transport = faultAdapter(sim);
  await useLaserStore.getState().connect(transport.adapter, { controllerKind: 'smoothieware' });
  await vi.advanceTimersByTimeAsync(2_000);
  transport.arm(fault);
  return sim;
}

function expectNoFrameMotion(sim: SmoothieSimulator, from = 0): void {
  const payload = sim.outbound().slice(from).join('');
  expect(payload).not.toMatch(/(?:^|\n)(?:M120|G0|G1|\$J=)/);
  expect(useLaserStore.getState().framedRun).toBeNull();
  expect(sim.state().pos).toEqual({ x: 0, y: 0, z: 0 });
}

describe('Smoothieware Frame report-unit exchange boundaries', () => {
  it.each(['reject', 'no-ack', 'no-report', 'run-report', 'stale-only', 'incomplete'] as const)(
    '%s fails ordinary Frame before any motion or permit',
    async (fault) => {
      const sim = await connectFaulted(fault);
      const pending = runFrameNow().then((result) => ({
        result,
        message: useToastStore.getState().toasts.at(-1)?.message,
      }));
      await vi.advanceTimersByTimeAsync(12_000);
      const completed = await pending;
      expect(completed.result).toBe(false);
      expectNoFrameMotion(sim);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(completed.message).toContain('report units');
      if (fault === 'stale-only' || fault === 'no-report') {
        expect(useLaserStore.getState().statusReport).toBeNull();
        expect(useLaserStore.getState().wcoCache).toBeNull();
      }
    },
  );

  it('Cancel during the G21 acknowledgement waits abandons setup without motion', async () => {
    const sim = await connectFaulted('no-ack');
    const pending = runFrameNow();
    await vi.advanceTimersByTimeAsync(50);
    expect(useFramePreparationStore.getState().cancellable).toBe(true);
    cancelOwnedFramePreparation();
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(false);
    expectNoFrameMotion(sim);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Frame preparation cancelled. No Start permit was issued.',
    );
  });

  it('Cancel after G21 ACK while the fresh status is silent abandons setup', async () => {
    const sim = await connectFaulted('no-report');
    const abort = new AbortController();
    const pending = useLaserStore
      .getState()
      .normalizeFrameReportUnits(abort.signal)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(sim.outbound()).toContain('G21\n');
    abort.abort();
    const error = await pending;
    expect(error).toMatchObject({ name: 'AbortError' });
    expectNoFrameMotion(sim);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('synchronous cancellation at coordinate invalidation prevents G21 dispatch', async () => {
    const sim = await connectFaulted('none');
    const abort = new AbortController();
    const unsubscribe = useLaserStore.subscribe((state) => {
      if (state.reportUnitsUnconfirmed === true) abort.abort();
    });
    const pending = useLaserStore
      .getState()
      .normalizeFrameReportUnits(abort.signal)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    unsubscribe();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(sim.outbound()).not.toContain('G21\n');
    expectNoFrameMotion(sim);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('a replaced serial session cannot resume an old unit exchange or clear the new owner', async () => {
    const old = await connectFaulted('no-ack');
    const pending = runFrameNow();
    await vi.advanceTimersByTimeAsync(50);
    old.port.emitClose();
    const next = createSmoothieSimulator();
    await useLaserStore.getState().connect(next.adapter, { controllerKind: 'smoothieware' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBe(false);
    old.port.emitLine('ok');
    await vi.advanceTimersByTimeAsync(100);
    expectNoFrameMotion(old);
    expectNoFrameMotion(next);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('an active job receives no G21 normalization command', async () => {
    const sim = await connectFaulted('none');
    await startTestLaserJob('G21\nG90\nG0 X5 Y5\nM5\n', { streamingMode: 'ping-pong' });
    const before = sim.outbound().length;
    await expect(useLaserStore.getState().normalizeFrameReportUnits()).rejects.toThrow('job');
    expect(sim.outbound().slice(before)).toEqual([]);
  });

  it('pending earlier acknowledgement prevents G21 from borrowing that terminal reply', async () => {
    const sim = await connectFaulted('none');
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    const before = sim.outbound().length;
    await expect(useLaserStore.getState().normalizeFrameReportUnits()).rejects.toThrow(
      'previous controller command',
    );
    expect(sim.outbound().slice(before)).toEqual([]);
  });

  it('the unit owner excludes concurrent jogs and mutating Console commands', async () => {
    const sim = await connectFaulted('no-report');
    const abort = new AbortController();
    const pending = useLaserStore
      .getState()
      .normalizeFrameReportUnits(abort.signal)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(50);
    const before = sim.outbound().length;
    await expect(useLaserStore.getState().jog({ dx: 5, dy: 5, feed: 1000 })).rejects.toThrow(
      'operation',
    );
    await expect(useLaserStore.getState().sendConsoleCommand('G92 X0 Y0')).rejects.toThrow(
      'operation',
    );
    expect(sim.outbound().slice(before)).toEqual([]);
    abort.abort();
    await pending;
    expectNoFrameMotion(sim);
  });

  it('transient Frame preparation owns the same failed unit boundary', async () => {
    const sim = await connectFaulted('reject');
    const pending = prepareTransientFrameController(useStore.getState().project);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    expectNoFrameMotion(sim);
  });

  it('GRBL report units remain independent of modal G20/G21', async () => {
    const sim = createGrblSimulator({
      settings: [
        [13, '1'],
        [22, '0'],
      ],
    });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grbl-v1.1' });
    await vi.advanceTimersByTimeAsync(2_000);
    const before = sim.outbound().length;
    await useLaserStore.getState().normalizeFrameReportUnits();
    expect(sim.outbound().slice(before)).toEqual([]);
    expect(useLaserStore.getState().controllerSettings?.reportInches).toBe(true);
  });
});
