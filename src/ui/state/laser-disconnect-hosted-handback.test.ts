// Marlin Disconnect with the worker-hosted refill armed (ADR-676 Amendment 1,
// rolling audit v8 N1-P2-1). The stop lines go out with the release, so they
// never wait behind the lines the worker forwarded while this thread was
// busy. The freeze still waits for the worker's reply, so a line the worker
// sent before the release reached it stays on this side's ledger, and its
// reply cannot settle a stop line (audit F1).

import { describe, expect, it, vi } from 'vitest';
import { marlinDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { stopBeforeDisconnect } from './laser-disconnect-stop';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createSafeWrite } from './laser-safe-write';
import type { LiveRefs } from './laser-store';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Marlin Disconnect with an armed worker refill', () => {
  it('writes its stop lines with the release and freezes only after the reply', async () => {
    const handback = deferred();
    let armed = true;
    const writes: string[] = [];
    const hosted: HostedStreamRefill = {
      isArmed: () => armed,
      arm: async () => undefined,
      release: vi.fn(async () => {
        await handback.promise;
        armed = false;
      }),
      onWriteError: () => () => undefined,
    };
    const connection: SerialConnection = {
      write: async (line) => {
        writes.push(line);
      },
      onLine: () => () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
      hostedStreaming: hosted,
    };
    const { refs: base, set, get } = makeLineHandlerHarness();
    const refs = {
      ...base,
      driver: marlinDriver,
      nextTranscriptId: 1,
      connection,
    } as unknown as LiveRefs;
    set({
      activeControllerKind: 'marlin',
      capabilities: marlinDriver.capabilities,
      activeJobMachineKind: 'laser',
      streamer: step(
        createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100\nM5 I\n', {
          streamingMode: 'ping-pong',
        }),
      ).state,
    });
    const safeWrite = createSafeWrite(set, get, refs);

    const stopping = stopBeforeDisconnect(set, get, refs, safeWrite, connection);
    expect(hosted.release).toHaveBeenCalledOnce();
    expect(writes).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    expect(get().streamer?.status).toBe('streaming');
    // The worker answered this ok with its next line before the release
    // reached it, so the stream still steps.
    handleLine(set, get, refs, safeWrite, 'ok');
    expect(get().streamer).toMatchObject({ status: 'streaming', completed: 1 });

    handback.resolve();
    await stopping;
    expect(get().streamer).toMatchObject({ status: 'paused', completed: 1 });
    expect(get().controllerOperation).toEqual({ kind: 'disconnect', phase: 'stopping' });
    expect(writes).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    // That line's reply settles the stream; each stop line's, the ledger.
    handleLine(set, get, refs, safeWrite, 'ok');
    expect(get().streamer).toMatchObject({ completed: 2, inFlight: [] });
    expect(get().pendingUntrackedAcks).toBe(3);
    for (let index = 0; index < 3; index += 1) handleLine(set, get, refs, safeWrite, 'ok');
    expect(get().pendingUntrackedAcks).toBe(0);
  });
});
