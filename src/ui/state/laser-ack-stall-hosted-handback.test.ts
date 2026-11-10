import { describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { marlinDriver } from '../../core/controllers';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createLaserStoreRefs } from './laser-store-refs';
import { createSafeWrite } from './laser-safe-write';
import { handleLine } from './laser-line-handler';
import { acknowledgementStalledNotice } from './laser-safety-notice';
import { containStalledStreamAcknowledgements } from './laser-stream-heartbeat-containment';

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

const STOP_LINES = ['M107\n', 'M410\n', 'M5 I\n', 'M9\n'];

// A Marlin job whose refill the serial worker holds (ADR-676), one move in
// flight, when the 90 s acknowledgement-hold watchdog gives up on it.
function stalledHostedHarness() {
  const handback = deferred();
  let armed = true;
  const hosted: HostedStreamRefill = {
    isArmed: () => armed,
    arm: async () => undefined,
    release: vi.fn(async () => {
      await handback.promise;
      armed = false;
    }),
    onWriteError: () => () => undefined,
  };
  const writes: string[] = [];
  const { set, get } = makeLineHandlerHarness();
  const connection: SerialConnection = {
    write: async (line) => {
      writes.push(line);
    },
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
    hostedStreaming: hosted,
  };
  const refs = createLaserStoreRefs();
  refs.driver = marlinDriver;
  refs.nextTranscriptId = 1;
  refs.connection = connection;
  set({
    activeControllerKind: 'marlin',
    capabilities: marlinDriver.capabilities,
    activeJobMachineKind: 'laser',
    streamer: step(
      createStreamer('G1 X1 S100\nG1 X2 S100\nM8\nM5 I\n', { streamingMode: 'ping-pong' }),
    ).state,
  });
  const safeWrite = createSafeWrite(set, get, refs);
  return {
    get,
    hosted,
    writes,
    handback,
    contain: () => containStalledStreamAcknowledgements(set, refs, safeWrite),
    emit: (line: string) => handleLine(set, get, refs, safeWrite, line),
  };
}

// Rolling audit v8 N1-P3-1 (ADR-676 Amendment 4). The containment used to mark
// the stream errored before the worker gave the refill back. An `ok` reaching
// the worker in that instant made it write one more job line the frozen ledger
// lacked, and that line's reply then settled a stop line. Like Abort and
// Disconnect, the containment now posts the release and the stop lines at
// once, and freezes only after the worker's reply.
describe('Marlin acknowledgement-stall containment with a worker-held refill', () => {
  it('takes the refill back before freezing, keeping both ledgers in step', async () => {
    const harness = stalledHostedHarness();
    harness.contain();
    expect(harness.hosted.release).toHaveBeenCalledOnce();
    await flush();
    expect(harness.writes).toEqual(STOP_LINES);
    expect(harness.get().streamer?.status).toBe('streaming');
    expect(harness.get().pendingUntrackedAcks).toBe(4);

    // The worker answered this ok by writing the next job line itself, before
    // the release reached it. This side's stream steps with it.
    harness.emit('ok');
    expect(harness.get().streamer).toMatchObject({ status: 'streaming', completed: 1 });
    expect(harness.get().pendingUntrackedAcks).toBe(4);

    harness.handback.resolve();
    await flush();
    expect(harness.get().streamer?.status).toBe('errored');
    expect(harness.get().safetyNotice?.message).toBe(acknowledgementStalledNotice(false).message);
    expect(harness.get().incidentHistory).toHaveLength(1);
    expect(harness.writes).toEqual(STOP_LINES);

    // The worker's line replies to the job, not to a stop line; then the stop
    // lines settle the untracked ledger exactly.
    harness.emit('ok');
    expect(harness.get().streamer).toMatchObject({ completed: 2, inFlight: [] });
    expect(harness.get().pendingUntrackedAcks).toBe(4);
    for (let index = 0; index < 4; index += 1) harness.emit('ok');
    expect(harness.get().pendingUntrackedAcks).toBe(0);
  });

  it('starts one containment while the handback is pending, however often the poll asks', async () => {
    const harness = stalledHostedHarness();
    harness.contain();
    await flush();
    harness.contain();
    harness.contain();
    await flush();
    expect(harness.hosted.release).toHaveBeenCalledOnce();
    expect(harness.writes).toEqual(STOP_LINES);
    expect(harness.get().pendingUntrackedAcks).toBe(4);

    harness.handback.resolve();
    await flush();
    expect(harness.get().streamer?.status).toBe('errored');
    expect(harness.get().incidentHistory).toHaveLength(1);
    harness.contain();
    await flush();
    expect(harness.writes).toEqual(STOP_LINES);
  });
});
