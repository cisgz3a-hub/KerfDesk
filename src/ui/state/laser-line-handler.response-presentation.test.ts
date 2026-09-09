import { describe, expect, it, vi } from 'vitest';
import { fluidncDriver, grblDriver, grblHalDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';

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
      const { refs, set, get } = makeLineHandlerHarness();
      refs.driver = driver;
      set({
        activeControllerKind: driver.kind,
        streamer: step(createStreamer('G1 X1 F600\nG1 X2 F600\n')).state,
        pendingUntrackedAcks: 1,
      });
      const safeWrite = vi.fn(async () => undefined);

      handleLine(set, get, refs, safeWrite, 'error:172');
      await Promise.resolve();

      expect(get()).toMatchObject({
        lastError: 172,
        pendingUntrackedAcks: 1,
        streamer: { status: 'errored', inFlight: [] },
      });
      expect(get().transcript.at(-1)).toMatchObject({
        raw: 'error:172',
        kind: 'error',
        decoded: 'Error 172',
      });
      expect(safeWrite).toHaveBeenCalledWith('\x18', 'stop', 'system');
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
