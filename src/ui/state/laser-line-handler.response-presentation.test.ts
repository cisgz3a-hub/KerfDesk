import { afterEach, describe, expect, it, vi } from 'vitest';
import { fluidncDriver, grblDriver, grblHalDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { reserveUntrackedAcks } from './laser-untracked-ack-ledger';

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  for (let index = 0; index < 15; index += 1) await Promise.resolve();
}

describe('live configured-family response presentation', () => {
  it.each([
    [fluidncDriver, 'Soft limit error'],
    [
      grblDriver,
      'Homing not enabled: Soft limits ($20=1) cannot be enabled without homing ($22=1) also enabled.',
    ],
    [
      grblHalDriver,
      'Homing not enabled: Soft limits ($20=1) cannot be enabled without homing ($22=1) also enabled.',
    ],
  ] as const)(
    'uses the configured driver despite a different detected banner (%#)',
    (driver, decoded) => {
      const { refs, set, get } = makeLineHandlerHarness();
      refs.driver = driver;
      set({
        activeControllerKind: driver.kind,
        detectedControllerKind: driver.kind === 'fluidnc' ? 'grbl-v1.1' : 'fluidnc',
        pendingUntrackedAcks: 1,
      });
      const safeWrite = vi.fn(async () => undefined);

      handleLine(set, get, refs, safeWrite, 'error:10');

      expect(get().transcript.at(-1)).toMatchObject({
        raw: 'error:10',
        kind: 'error',
        source: 'controller',
        decoded,
      });
      expect(get()).toMatchObject({ lastError: 10, pendingUntrackedAcks: 0, streamer: null });
      expect(safeWrite).not.toHaveBeenCalled();
    },
  );

  it.each([fluidncDriver, grblDriver, grblHalDriver])(
    'keeps $kind stream rejection terminal and leaves later ACK ownership intact',
    async (driver) => {
      vi.useFakeTimers();
      const { refs, set, get } = makeLineHandlerHarness();
      refs.driver = driver;
      const dispatched = step(createStreamer('G1 X1 F600\nG1 X2 F600\n')).state;
      set({ activeControllerKind: driver.kind, streamer: dispatched, pendingUntrackedAcks: 1 });
      const safeWrite = vi.fn(async (line: string) => {
        if (line === 'M5\n' || line === 'M9\n') {
          reserveUntrackedAcks(refs, 1);
          set((state) => ({ pendingUntrackedAcks: state.pendingUntrackedAcks + 1 }));
        }
      });

      handleLine(set, get, refs, safeWrite, 'error:172');
      await flush();

      expect(get()).toMatchObject({
        lastError: 172,
        pendingUntrackedAcks: 1,
        streamer: { status: 'errored', inFlight: dispatched.inFlight.slice(1) },
      });
      expect(get().transcript.at(-1)).toMatchObject({
        raw: 'error:172',
        kind: 'error',
        decoded: 'Error 172',
      });
      expect(safeWrite).toHaveBeenCalledExactlyOnceWith('\x18', 'stop', 'system');
      const owner = get().controllerOperation;

      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get()).toMatchObject({
        pendingUntrackedAcks: 1,
        streamer: { status: 'errored', inFlight: [] },
      });
      handleLine(set, get, refs, safeWrite, '<Idle|MPos:0,0,0|FS:0,0>');
      expect(get().streamer?.status).toBe('errored');
      expect(get().controllerOperation).toBe(owner);
      expect(safeWrite).toHaveBeenCalledTimes(1);

      handleLine(set, get, refs, safeWrite, 'Grbl 1.1f');
      await flush();
      expect(get().streamer?.inFlight).toEqual([]);
      expect(get().pendingUntrackedAcks).toBe(2);
      expect(safeWrite).toHaveBeenCalledWith('M5\n', 'stop', 'system');
      expect(safeWrite).toHaveBeenCalledWith('M9\n', 'stop', 'system');
      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get().pendingUntrackedAcks).toBe(1);
      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get().pendingUntrackedAcks).toBe(0);
      expect(safeWrite.mock.calls.map(([line]) => line)).toEqual(['\x18', 'M5\n', 'M9\n']);
    },
  );

  it('displays a FluidNC alarm while preserving shared alarm containment', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    refs.driver = fluidncDriver;
    set({ activeControllerKind: 'fluidnc', pendingUntrackedAcks: 1 });

    handleLine(set, get, refs, async () => undefined, 'ALARM:12');

    // The existing alarm path retires the ACK ledger as part of containment.
    expect(get()).toMatchObject({ alarmCode: 12, pendingUntrackedAcks: 0 });
    expect(get().transcript.at(-1)).toMatchObject({
      raw: 'ALARM:12',
      kind: 'alarm',
      decoded: 'Ambiguous Switch',
    });
  });
});
