// Code quality audit C2, D3 (test strength): Abort's ownership and ordering
// guards in laser-job-stop.ts. Each race below starts Abort, lets newer work
// take the controller (or the transport) before one of Abort's awaits
// settles, and asserts that the old Abort writes and applies nothing more.
// Mutants: X02 (Smoothieware release await), X05 (stop lines after ownership
// is lost), X11 (ownership ignores a newer stream), X13 (a jog-stop result
// after the transport changed). X07, Abort while the page closes, is in
// laser-unowned-motion-stop.simulator.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  grblDriver,
  marlinDriver,
  smoothiewareDriver,
  type ControllerDriver,
} from '../../core/controllers';
import { createStreamer, parseStatusReport, step } from '../../core/controllers/grbl';
import type { HostedStreamRefill, SerialConnection } from '../../platform/types';
import { interactiveControllerOperation } from './laser-controller-operation';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { runStopJob } from './laser-job-stop';
import { createSafeWrite } from './laser-safe-write';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

function connectionFor(
  write: (data: string) => Promise<void>,
  hostedStreaming?: HostedStreamRefill,
): SerialConnection {
  return {
    write,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
    ...(hostedStreaming === undefined ? {} : { hostedStreaming }),
  };
}

function stopHarness(
  driver: ControllerDriver,
  write: (data: string) => Promise<void>,
  hostedStreaming?: HostedStreamRefill,
) {
  const { refs: initialRefs, set, get } = makeLineHandlerHarness();
  const refs = {
    ...initialRefs,
    driver,
    nextTranscriptId: 1,
    connection: connectionFor(write, hostedStreaming) as SerialConnection | null,
  };
  set({ activeControllerKind: driver.kind, capabilities: driver.capabilities });
  const safeWrite = createSafeWrite(set, get, refs);
  return {
    set,
    get,
    refs,
    stop: () => runStopJob({ set, get, refs, safeWrite, driver: () => driver }, 'operator'),
    emit: (line: string) => handleLine(set, get, refs, safeWrite, line),
  };
}

function runningJob() {
  return step(
    createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100\n', { streamingMode: 'ping-pong' }),
  ).state;
}

// The stop lines a Marlin Abort writes one after another (laser-quick-stop.ts).
const MARLIN_STOP_LINES = ['M107\n', 'M410\n', 'M5 I\n'];

describe('a Marlin Abort whose ownership is lost during its first stop write', () => {
  it.each([
    {
      // X11, and X05: a new job's stream replaces the one Abort cancelled.
      newer: 'a new job starts streaming',
      ownsOperation: false,
      takeOver: (h: ReturnType<typeof stopHarness>) =>
        h.set((state) => ({ streamer: runningJob(), streamerEpoch: state.streamerEpoch + 1 })),
    },
    {
      // X05: another controller operation takes the controller.
      newer: 'another controller operation starts',
      ownsOperation: true,
      takeOver: (h: ReturnType<typeof stopHarness>) =>
        h.set({
          controllerOperation: interactiveControllerOperation('Homing', 'terminal-exchange'),
        }),
    },
  ])('writes no further stop line when $newer', async ({ takeOver, ownsOperation }) => {
    const first = deferred();
    const writes: string[] = [];
    const h = stopHarness(marlinDriver, async (data) => {
      writes.push(data);
      if (data === MARLIN_STOP_LINES[0]) await first.promise;
    });
    h.set({ activeJobMachineKind: 'laser', streamer: runningJob() });
    const stopping = h.stop();
    await flush();
    expect(writes).toEqual([MARLIN_STOP_LINES[0]]);

    takeOver(h);
    const newer = { streamer: h.get().streamer, operation: h.get().controllerOperation };
    first.resolve();
    await stopping;

    expect(writes).toEqual([MARLIN_STOP_LINES[0]]);
    // Nor is the old Abort's outcome applied to the newer work.
    expect(h.get().streamer).toBe(newer.streamer);
    if (ownsOperation) expect(h.get().controllerOperation).toBe(newer.operation);
  });
});

describe('a Smoothieware Abort with the hosted refill armed (X02)', () => {
  it('applies no stop outcome until the worker hands the refill back', async () => {
    const handback = deferred();
    const hosted: HostedStreamRefill = {
      isArmed: () => true,
      arm: async () => undefined,
      release: vi.fn(() => handback.promise),
      onWriteError: () => () => undefined,
    };
    const writes: string[] = [];
    const h = stopHarness(
      smoothiewareDriver,
      async (data) => {
        writes.push(data);
      },
      hosted,
    );
    h.set({ activeJobMachineKind: 'laser', streamer: runningJob() });
    let stopped = false;
    const stopping = h.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(100);

    // The reset went out first; the release is still being handed back.
    expect(writes[0]).toBe('\x18');
    expect(hosted.release).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    expect(h.get().streamer?.status).toBe('errored');

    handback.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    expect(h.get().streamer?.status).toBe('cancelled');
  });
});

describe('an Abort that cancels a Console jog while its transport is replaced (X13)', () => {
  it('applies no jog-stop result to the replacement transport', async () => {
    const writes: string[] = [];
    const h = stopHarness(grblDriver, async (data) => {
      writes.push(data);
    });
    const report = parseStatusReport('<Jog|MPos:10.000,0.000,0.000|FS:1000,0>');
    if (report === null) throw new Error('unparsed status report');
    h.set({
      statusReport: report,
      airAssistOn: true,
      cancelJog: async () => {
        writes.push('\x85');
      },
    });
    const stopping = h.stop();
    await flush();
    expect(writes).toContain('\x85');

    // Another connection takes the transport while Abort waits for Idle; the
    // controller session and the connection attempt have not changed yet.
    h.refs.connection = connectionFor(async (data) => {
      writes.push(`replacement:${data}`);
    });
    h.emit('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await vi.advanceTimersByTimeAsync(3_000);
    await stopping;

    expect(writes.filter((data) => data.startsWith('replacement:'))).toEqual([]);
    expect(h.get().safetyNotice).toBeNull();
    expect(h.get().airAssistOn).toBe(true);
  });
});
