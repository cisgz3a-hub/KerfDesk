import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancel, createStreamer, step } from '../../core/controllers/grbl/streamer';
import { marlinDriver } from '../../core/controllers/marlin/driver';
import type { SerialConnection } from '../../platform/types';
import { startControllerCommand } from './laser-interactive-command';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { hasPendingControllerWrite } from './laser-start-queue-fence';

// Marlin G2_G3.cpp reports invalid parameters, then gcode.cpp's caller sends
// the command's own ok. Error: must freeze execution without retiring its FIFO
// reservation. This is not GRBL's one terminal error:N response.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1016
const HANDLER_ERROR = 'Error:G2/G3 bad parameters';
const REJECTED_LINE = 'G2 X1 Y1 I0 J0\n';
const STOP_LINES = ['M107\n', 'M410\n', 'M5 I\n'];

afterEach(() => vi.useRealTimers());

function harness() {
  const { refs, set, get } = makeLineHandlerHarness();
  refs.driver = marlinDriver;
  const write = vi.fn(async (_line: string) => undefined);
  Object.assign(refs, {
    connection: { write } as unknown as SerialConnection,
    nextTranscriptId: 1,
  });
  set({ capabilities: marlinDriver.capabilities, activeControllerKind: 'marlin' });
  const safeWrite = createSafeWrite(set, get, refs as SafeWriteRefs);
  return {
    refs,
    set,
    get,
    write,
    safeWrite,
    receive: (line: string) => handleLine(set, get, refs, safeWrite, line),
  };
}

async function flushWrites(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('Marlin error reports preserve acknowledgement ownership', () => {
  it.each([false, true])(
    'freezes immediately and keeps cleanup replies behind the rejected line (resend: %s)',
    async (resend) => {
      const h = harness();
      h.set({
        streamer: step(createStreamer(`${REJECTED_LINE}G1 X2\n`, { streamingMode: 'ping-pong' }))
          .state,
      });

      h.receive(HANDLER_ERROR);
      if (resend) h.receive('Resend: 4');
      expect(h.get().streamer).toMatchObject({ status: 'errored', completed: 0 });
      expect(h.get().streamer?.inFlight.map((item) => item.line)).toEqual([REJECTED_LINE]);
      await flushWrites();
      expect(h.write.mock.calls.map(([line]) => line)).toEqual(STOP_LINES);
      expect(h.get().pendingUntrackedAcks).toBe(3);

      h.receive('ok'); // Rejected job line, before any cleanup command answered.
      expect(h.get().streamer?.inFlight).toEqual([]);
      expect(h.get().pendingUntrackedAcks).toBe(3);
      expect(h.get().streamer?.status).toBe('errored');
      for (const remaining of [2, 1, 0]) {
        h.receive('ok');
        expect(h.get().pendingUntrackedAcks).toBe(remaining);
      }
      expect(h.write.mock.calls.map(([line]) => line)).toEqual(STOP_LINES);
    },
  );

  it.each([false, true])(
    'keeps Console debt ahead of a queued command (resend: %s)',
    async (resend) => {
      const h = harness();
      await h.safeWrite(REJECTED_LINE, 'console', 'console');
      await h.safeWrite('M400\n', 'console', 'console');
      h.receive(HANDLER_ERROR);
      if (resend) h.receive('Resend: 4');
      expect(h.get().pendingUntrackedAcks).toBe(2);
      expect(hasPendingControllerWrite(h.get())).toBe(true);
      h.receive('ok'); // Rejected line, not M400.
      expect(h.get().pendingUntrackedAcks).toBe(1);
      expect(hasPendingControllerWrite(h.get())).toBe(true);
      h.receive('ok');
      expect(h.get().pendingUntrackedAcks).toBe(0);
      expect(h.write.mock.calls.map(([line]) => line)).toEqual([REJECTED_LINE, 'M400\n']);
    },
  );

  it('preserves an operator cancellation when the rejected line answers after Abort', async () => {
    const h = harness();
    h.set({ streamer: cancel(step(createStreamer(REJECTED_LINE)).state) });
    h.receive(HANDLER_ERROR);
    expect(h.get().streamer).toMatchObject({ status: 'cancelled', completed: 0 });
    expect(h.get().streamer?.inFlight.map((item) => item.line)).toEqual([REJECTED_LINE]);
    h.receive('ok');
    expect(h.get().streamer).toMatchObject({ status: 'cancelled', completed: 1, inFlight: [] });
    await flushWrites();
    expect(h.write).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'retains an owned command until its error is followed by ok (early reply: %s)',
    async (earlyReply) => {
      vi.useFakeTimers();
      const h = harness();
      let settled = false;
      const command = startControllerCommand(h.refs, h.safeWrite, {
        kind: 'interactive-command',
        label: 'Arc command',
        command: REJECTED_LINE,
      }).catch((error: unknown) => {
        settled = true;
        return error;
      });
      if (!earlyReply) await flushWrites();
      h.receive(HANDLER_ERROR);
      await flushWrites();
      expect(settled).toBe(false);
      expect(h.refs.controllerCommand).not.toBeNull();
      expect(h.get().pendingUntrackedAcks).toBe(1);
      h.receive('ok');
      expect(await command).toMatchObject({ message: HANDLER_ERROR });
      expect(h.refs.controllerCommand).toBeNull();
      expect(h.get().pendingUntrackedAcks).toBe(0);
    },
  );

  it('keeps kill() separate: halting firmware owes no following ok and gets no cleanup', async () => {
    const h = harness();
    h.set({
      streamer: step(createStreamer(`${REJECTED_LINE}G1 X2\n`, { streamingMode: 'ping-pong' }))
        .state,
    });
    h.receive('Error:Printer halted. kill() called!');
    await flushWrites();
    expect(h.get().streamer?.status).toBe('errored');
    expect(h.get().safetyNotice).toMatchObject({ halted: true });
    expect(h.write).not.toHaveBeenCalled();
  });
});
