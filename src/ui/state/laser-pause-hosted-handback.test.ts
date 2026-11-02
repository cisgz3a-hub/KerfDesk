// Marlin Pause with the worker-hosted refill armed (ADR-676 Amendment 2, rolling
// audit v9 R1-P2-1). The beam-off goes out with the release, so it never waits
// behind the lines the worker forwarded while this thread was busy. The freeze
// still waits for the worker's reply, so Pause stops at the line where the worker
// stopped, and that line's reply cannot settle the beam-off (audit F1).

import { describe, expect, it, vi } from 'vitest';
import { marlinDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { runConfirmedPauseJob } from './laser-job-pause-resume';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createSafeWrite } from './laser-safe-write';
import type { LiveRefs } from './laser-store';

const FAN_JOB = 'G0 X5\nM106 S204\nG1 X1\nG1 X2\nM107\nG0 X0\n';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pauseHarness(options: { readonly armed: boolean }) {
  const handback = deferred();
  let armed = options.armed;
  const writes: string[] = [];
  const hosted: HostedStreamRefill = {
    isArmed: () => armed,
    arm: async () => undefined,
    release: vi.fn(async () => {
      if (armed) await handback.promise;
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
  const refs = Object.assign(base, { connection, driver: marlinDriver }) as unknown as LiveRefs;
  set({
    capabilities: marlinDriver.capabilities,
    activeControllerKind: 'marlin',
    streamer: step(createStreamer(FAN_JOB, { streamingMode: 'ping-pong' })).state,
  });
  const safeWrite = createSafeWrite(set, get, refs);
  const notices: string[] = [];
  set({ pushSystemNotice: (line: string) => void notices.push(line) } as never);
  const context = {
    set,
    get,
    refs,
    safeWrite,
    driver: () => marlinDriver,
    failDarkStop: async () => undefined,
  };
  return { context, writes, handback, notices, set, get, refs, safeWrite };
}

describe('Marlin Pause with an armed worker refill', () => {
  it('writes the beam-off with the release and freezes only after the reply', async () => {
    const h = pauseHarness({ armed: true });

    const pausing = runConfirmedPauseJob(h.context);
    await Promise.resolve();
    // The window's stream has not reached the M106 the worker may have sent,
    // and the beam-off is on its way all the same.
    expect(h.writes).toEqual(['M107\n']);
    expect(h.get().streamer?.status).toBe('streaming');

    // A line the worker forwarded before the release steps this side's stream.
    handleLine(h.set, h.get, h.refs as never, h.safeWrite, 'ok');
    expect(h.get().streamer?.completed).toBe(1);
    expect(h.get().pendingUntrackedAcks).toBe(1);

    h.handback.resolve();
    await pausing;
    expect(h.get().streamer?.status).toBe('paused');
    expect(h.writes).toEqual(['M107\n']);
    expect(h.notices).toEqual([expect.stringContaining('KerfDesk queued M107')]);

    // The line in flight at the freeze, then the beam-off, each settle their own.
    handleLine(h.set, h.get, h.refs as never, h.safeWrite, 'ok');
    expect(h.get().pendingUntrackedAcks).toBe(1);
    handleLine(h.set, h.get, h.refs as never, h.safeWrite, 'ok');
    expect(h.get().pendingUntrackedAcks).toBe(0);
  });

  it('writes nothing more when the connection is replaced behind the backlog', async () => {
    const h = pauseHarness({ armed: true });

    const pausing = runConfirmedPauseJob(h.context).catch((error: unknown) => error);
    await Promise.resolve();
    expect(h.writes).toEqual(['M107\n']);

    (h.refs as { connection: SerialConnection | null }).connection = null;
    h.handback.resolve();

    expect(await pausing).toBeInstanceOf(Error);
    expect(h.writes).toEqual(['M107\n']);
    expect(h.get().streamer?.status).toBe('streaming');
  });

  it('with the window streaming, freezes first and writes what the position needs', async () => {
    const h = pauseHarness({ armed: false });

    await runConfirmedPauseJob(h.context);

    // The fan is still off at this line, and nothing else can have gone further.
    expect(h.get().streamer?.status).toBe('paused');
    expect(h.writes).toEqual([]);
  });
});
