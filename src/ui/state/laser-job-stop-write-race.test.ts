import { describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { marlinDriver } from '../../core/controllers';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createSafeWrite } from './laser-safe-write';
import { handleLine } from './laser-line-handler';
import { runStopJob } from './laser-job-stop';
import { CONTROLLER_OPERATION_ACTIVE_MESSAGE } from './laser-controller-operation';
import { setupCommandBlockMessage } from './laser-store-helpers';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function stopHarness(write: (data: string) => Promise<void>, hostedStreaming?: HostedStreamRefill) {
  const { refs: initialRefs, set, get } = makeLineHandlerHarness();
  const connection: SerialConnection = {
    write,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
    ...(hostedStreaming === undefined ? {} : { hostedStreaming }),
  };
  const refs = { ...initialRefs, driver: marlinDriver, nextTranscriptId: 1, connection };
  set({
    activeControllerKind: 'marlin',
    capabilities: marlinDriver.capabilities,
    activeJobMachineKind: 'laser',
    streamer: step(
      createStreamer('G1 X1 S100\nG1 X2 S100\nM8\nM5 I\n', {
        streamingMode: 'ping-pong',
      }),
    ).state,
  });
  const safeWrite = createSafeWrite(set, get, refs);
  return {
    set,
    get,
    refs,
    stop: () => runStopJob({ set, get, refs, safeWrite, driver: () => marlinDriver }, 'operator'),
    emit: (line: string) => handleLine(set, get, refs, safeWrite, line),
  };
}

const STOP_LINES = ['M107\n', 'M410\n', 'M5 I\n', 'M9\n'];

describe('Marlin Abort owns delayed transport writes', () => {
  it.each(STOP_LINES)('does not refill during a delayed %j stop write', async (delayedLine) => {
    const delayed = deferred();
    const writes: string[] = [];
    const harness = stopHarness(async (data) => {
      writes.push(data);
      if (data === delayedLine) await delayed.promise;
    });
    const inFlight = harness.get().streamer?.inFlight;
    const stopping = harness.stop();

    // Freeze is synchronous, including before hosted handback yields.
    expect(harness.get().streamer).toMatchObject({ status: 'cancelled', completed: 0 });
    expect(harness.get().streamer?.inFlight).toBe(inFlight);
    await flush();
    expect(writes.at(-1)).toBe(delayedLine);
    const pendingStopAcks = harness.get().pendingUntrackedAcks;
    harness.emit('ok'); // The old job's one sent move, not any stop line.
    expect(harness.get().streamer).toMatchObject({ completed: 1, inFlight: [] });
    expect(harness.get().pendingUntrackedAcks).toBe(pendingStopAcks);

    // Every written line may reply before write() settles. Even a fresh Idle
    // must retain Abort's owner until its final stop write has been accepted.
    for (let index = 0; index < pendingStopAcks; index += 1) harness.emit('ok');
    harness.emit('X:1.00 Y:0.00 Z:0.00');
    expect(harness.get().pendingUntrackedAcks).toBe(0);
    expect(setupCommandBlockMessage(harness.get())).toBe(CONTROLLER_OPERATION_ACTIVE_MESSAGE);
    expect(harness.get().streamer?.status).toBe('cancelled');
    expect(writes.some((line) => line.startsWith('G1'))).toBe(false);

    delayed.resolve();
    await stopping;
    expect(writes).toEqual(STOP_LINES); // M8 in the retired queue still requires M9.
    expect(harness.get().controllerOperation).toBeNull();
    expect(harness.get().safetyNotice?.kind).toBe('disconnect-stop-unconfirmed');
    expect(harness.get().jobStopRequest).toMatchObject({ reason: 'operator' });
  });

  it('freezes before delayed hosted handback and retains its old ACK ledger', async () => {
    const handback = deferred();
    const writes: string[] = [];
    const hosted: HostedStreamRefill = {
      isArmed: () => false,
      arm: async () => undefined,
      release: vi.fn(() => handback.promise),
      onWriteError: () => () => undefined,
    };
    const harness = stopHarness(async (line) => {
      writes.push(line);
    }, hosted);
    const stopping = harness.stop();
    expect(hosted.release).toHaveBeenCalledOnce();
    harness.emit('ok');
    harness.emit('X:1.00 Y:0.00 Z:0.00');
    await flush();
    expect(writes).toEqual([]);
    expect(harness.get().streamer).toMatchObject({
      status: 'cancelled',
      completed: 1,
      inFlight: [],
    });
    expect(setupCommandBlockMessage(harness.get())).toBe(CONTROLLER_OPERATION_ACTIVE_MESSAGE);

    handback.resolve();
    await stopping;
    expect(writes).toEqual(STOP_LINES);
    expect(harness.get().pendingUntrackedAcks).toBe(4);
    for (let index = 0; index < 4; index += 1) harness.emit('ok');
    expect(harness.get().pendingUntrackedAcks).toBe(0);
  });
});
