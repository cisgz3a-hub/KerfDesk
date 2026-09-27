import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  grblDriver,
  marlinDriver,
  smoothiewareDriver,
  type ControllerDriver,
} from '../../core/controllers';
import { parseStatusReport } from '../../core/controllers/grbl';
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
  const report = (offset: { x: number; y: number; z: number }) => {
    const next = parseStatusReport(
      `<Idle|MPos:100,200,10|WCO:${offset.x},${offset.y},${offset.z}|FS:0,0>`,
    )!;
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
  };
  return { refs, set, get, report };
}

async function flush() {
  for (let i = 0; i < 35; i += 1) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('Restore saved origin controller evidence and units', () => {
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
      if (boundary === 'write epoch') h.refs.writeEpoch += 1;
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
    });
  }
});
