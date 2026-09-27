import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  grblDriver,
  marlinDriver,
  smoothiewareDriver,
  type ControllerDriver,
} from '../../core/controllers';
import { parseStatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  observeFreshControllerStatus,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import { OriginTransactionCancelledError } from './laser-origin-transaction';
import { restoreWorkOrigin } from './laser-origin-restore';
import { statusPositionPatch } from './laser-status-position';
import { useLaserStore, type LaserState, type LiveRefs } from './laser-store';

const saved = { x: 20, y: 30 };
const machine = { x: 100, y: 200, z: 10 };

function harness(driver: ControllerDriver = grblDriver) {
  let state: LaserState = {
    ...useLaserStore.getInitialState(),
    connection: { kind: 'connected' },
    capabilities: driver.capabilities,
    activeControllerKind: driver.kind,
    controllerSessionEpoch: 1,
    trustedPositionEpoch: 1,
    statusSequence: 1,
    statusObservation: { sessionEpoch: 1, positionEpoch: 1, sequence: 1, observedAt: Date.now() },
    statusReport: parseStatusReport('<Idle|MPos:100,200,10|WCO:0,0,4|FS:0,0>'),
    wcoCache: { x: 0, y: 0, z: 4 },
    workOriginVersion: 1,
    workOriginSource: 'none',
    workOriginActive: false,
    controllerOperation: null,
    log: [],
  };
  const refs = {
    controllerCommand: null,
    controllerIdleWait: null,
    controllerStatusWait: null,
    writeEpoch: 1,
    driver,
  } as LiveRefs;
  const set = (
    patch: Partial<LaserState> | ((current: LaserState) => Partial<LaserState> | LaserState),
  ) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = () => state;
  const status = (line: string) => {
    const next = parseStatusReport(line);
    if (next === null) throw new Error(`Invalid status fixture: ${line}`);
    set({
      ...statusPositionPatch(state, next),
      statusSequence: state.statusSequence + 1,
      statusObservation: {
        sessionEpoch: 1,
        positionEpoch: 1,
        sequence: state.statusSequence + 1,
        observedAt: Date.now(),
      },
    });
    observeFreshControllerStatus(
      refs,
      { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
      next,
    );
  };
  const report = (offset: { x: number; y: number; z: number }) =>
    status(`<Idle|MPos:100,200,10|WCO:${offset.x},${offset.y},${offset.z}|FS:0,0>`);
  return { refs, set, get, report, status };
}

async function flush() {
  for (let i = 0; i < 35; i += 1) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('Restore saved origin controller evidence and units', () => {
  for (const statusAfterWrite of [null, '<Idle|MPos:100,200,10|FS:0,0>']) {
    it(`does not confirm a pre-write matching cache from ${statusAfterWrite === null ? 'no new report' : 'a position-only report'}`, async () => {
      vi.useFakeTimers();
      const h = harness();
      h.report({ ...saved, z: 4 });
      const write = async () => {
        if (statusAfterWrite !== null) h.status(statusAfterWrite);
        queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
      };
      const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
      await vi.advanceTimersByTimeAsync(3_100);
      await pending;
      expect(h.get().wcoCache).toEqual({ ...saved, z: 4 });
      expect(h.get().log.join('\n')).toContain('has not confirmed the saved work offset');
    });
  }

  it('positive control: uses current machine position, preserves Z, and finishes after matching report', async () => {
    const h = harness();
    const writes: string[] = [];
    const write = async (line: string) => {
      writes.push(line);
      queueMicrotask(() => {
        h.report({ x: 20, y: 30, z: 4 });
        consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok');
      });
    };
    await restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
    expect(writes).toEqual(['G54 G21 G92 X80.000 Y170.000\n']);
    expect(h.get().wcoCache).toEqual({ x: 20, y: 30, z: 4 });
    expect(h.get().workOriginVersion).toBe(2);
    expect(h.get().frameVerification).toBeNull();
  });

  for (const [driver, line] of [
    [grblDriver, '<Idle|MPos:100,200,10|WCO:20,30,4|FS:0,0>'],
    [smoothiewareDriver, '<Idle|MPos:100,200,10|WPos:80,170,6|FS:0,0>'],
  ] as const) {
    it(`retains fresh ${driver.kind} offset proof followed by a position-only report before ACK`, async () => {
      const h = harness(driver);
      const write = async (command: string) => {
        if (command.includes('G92')) {
          h.status(line);
          h.status('<Idle|MPos:100,200,10|FS:0,0>');
        }
        queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
      };
      await restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
      expect(h.get().wcoCache).toEqual({ ...saved, z: 4 });
      expect(h.get().log.join('\n')).not.toContain('has not confirmed');
      expect(h.refs.controllerStatusWait).toBeNull();
    });
  }

  it('keeps the pre-ACK observer alive until a delayed acknowledgement', async () => {
    vi.useFakeTimers();
    const h = harness();
    const pending = restoreWorkOrigin(h.set, h.get, h.refs, async () => undefined, saved);
    await flush();
    await vi.advanceTimersByTimeAsync(7_000);
    h.report({ ...saved, z: 4 });
    h.status('<Idle|MPos:100,200,10|FS:0,0>');
    consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok');
    await pending;
    expect(h.get().log.join('\n')).not.toContain('has not confirmed');
    expect(h.refs.controllerStatusWait).toBeNull();
  });

  it('does not count a matching report received before the separate G21 acknowledgement', async () => {
    vi.useFakeTimers();
    const h = harness(smoothiewareDriver);
    const write = async (command: string) => {
      if (command === 'G21\n') h.report({ ...saved, z: 4 });
      queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
    };
    const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
    await vi.advanceTimersByTimeAsync(3_100);
    await pending;
    expect(h.get().log.join('\n')).toContain('has not confirmed');
    expect(h.refs.controllerStatusWait).toBeNull();
  });

  it('retires its offset observer when the G92 write fails', async () => {
    const h = harness();
    const write = async () => {
      throw new Error('Disconnected during G92');
    };
    await expect(restoreWorkOrigin(h.set, h.get, h.refs, write, saved)).rejects.toThrow(
      'Disconnected during G92',
    );
    expect(h.refs.controllerStatusWait).toBeNull();
  });

  it('does not cancel a replacement status observer when the restore loses ownership', async () => {
    vi.useFakeTimers();
    const h = harness();
    const write = async () => {
      queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
    };
    const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved).catch(
      (error: unknown) => error,
    );
    await flush();
    cancelFreshControllerStatusWait(h.refs);
    const replacement = waitForFreshControllerStatus(h.refs, {
      after: { sessionEpoch: 1, sequence: h.get().statusSequence },
      accept: () => false,
      timeoutMessage: 'Replacement timed out',
    }).catch((error: unknown) => error);
    const replacementWait = h.refs.controllerStatusWait;
    h.set({ controllerSessionEpoch: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeInstanceOf(OriginTransactionCancelledError);
    expect(h.refs.controllerStatusWait).toBe(replacementWait);
    cancelFreshControllerStatusWait(h.refs);
    await replacement;
  });

  for (const driver of [grblDriver, smoothiewareDriver]) {
    it(`preserves a fresh contradictory ${driver.kind} offset instead of the requested offset`, async () => {
      vi.useFakeTimers();
      const h = harness(driver);
      const write = async () => {
        queueMicrotask(() => {
          consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok');
        });
      };
      const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
      await flush();
      h.report({ x: 11, y: 12, z: 4 });
      await vi.advanceTimersByTimeAsync(3_100);
      await pending;
      expect(h.get().wcoCache).toEqual({ x: 11, y: 12, z: 4 });
      expect(h.get().statusReport?.wco).toEqual({ x: 11, y: 12, z: 4 });
      expect(h.get().log.join('\n')).toContain('has not confirmed the saved work offset');
    });
  }

  it('keeps an unreported full-WCS offset unknown after confirmation times out', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.set({ wcoCache: null, statusReport: parseStatusReport('<Idle|MPos:100,200,10|FS:0,0>') });
    const write = async () => {
      queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
    };
    const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
    await vi.advanceTimersByTimeAsync(3_100);
    await pending;
    expect(h.get().wcoCache).toBeNull();
    expect(h.get().log.join('\n')).toContain('has not confirmed the saved work offset');
  });

  for (const driver of [marlinDriver, smoothiewareDriver]) {
    it(`restores the requested physical offset on ${driver.kind} when G20 is active`, async () => {
      const h = harness(driver);
      let mmPerUnit = 25.4;
      let firmwareOffset = { x: 0, y: 0 };
      const writes: string[] = [];
      // Independent modal-unit oracle, following Marlin G92.cpp value_axis_units
      // and Smoothie Robot.cpp G92 to_millimeters; their local simulators omit G20.
      const write = async (line: string) => {
        writes.push(line);
        if (/\bG21\b/.test(line)) mmPerUnit = 1;
        if (/\bG92\b/.test(line)) {
          const x = Number(/X([-+\d.]+)/.exec(line)?.[1]);
          const y = Number(/Y([-+\d.]+)/.exec(line)?.[1]);
          firmwareOffset = { x: machine.x - x * mmPerUnit, y: machine.y - y * mmPerUnit };
          if (driver.capabilities.workOffsetSource !== 'host-recorded') {
            h.report({ ...firmwareOffset, z: 4 });
          }
        }
        queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
      };
      await restoreWorkOrigin(h.set, h.get, h.refs, write, saved);
      expect(writes).toEqual(['G21\n', 'G92 X80.000 Y170.000\n']);
      expect(firmwareOffset.x).toBeCloseTo(saved.x, 3);
      expect(firmwareOffset.y).toBeCloseTo(saved.y, 3);
    });
  }

  it('awaits G21 acknowledgement and cancels before G92 when the controller session changes', async () => {
    const h = harness(marlinDriver);
    const writes: string[] = [];
    const write = async (line: string) => {
      writes.push(line);
    };
    const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved).catch(
      (error: unknown) => error,
    );
    await flush();
    expect(writes).toEqual(['G21\n']);
    h.set({ controllerSessionEpoch: 2, wcoCache: { x: 91, y: 92, z: 93 } });
    consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok');
    expect(await pending).toBeInstanceOf(OriginTransactionCancelledError);
    expect(writes).toEqual(['G21\n']);
    expect(h.get().wcoCache).toEqual({ x: 91, y: 92, z: 93 });
  });

  for (const boundary of ['session', 'write epoch', 'replacement operation'] as const) {
    it(`positive ownership: ${boundary} invalidates a post-ACK restore wait`, async () => {
      vi.useFakeTimers();
      const h = harness();
      const write = async () => {
        queueMicrotask(() => consumeControllerCommandResponse(h.refs, { kind: 'ok' }, 'ok'));
      };
      const pending = restoreWorkOrigin(h.set, h.get, h.refs, write, saved).catch(
        (error: unknown) => error,
      );
      await flush();
      if (boundary === 'session') h.set({ controllerSessionEpoch: 2 });
      if (boundary === 'write epoch') h.refs.writeEpoch = (h.refs.writeEpoch ?? 0) + 1;
      if (boundary === 'replacement operation')
        h.set({
          controllerOperation: {
            kind: 'interactive-command',
            phase: 'command',
            label: 'new owner',
          },
        });
      h.set({ wcoCache: { x: 91, y: 92, z: 93 }, log: ['new owner'] });
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBeInstanceOf(OriginTransactionCancelledError);
      expect(h.get().wcoCache).toEqual({ x: 91, y: 92, z: 93 });
      expect(h.get().log).toEqual(['new owner']);
      expect(h.refs.controllerStatusWait).toBeNull();
    });
  }
});
