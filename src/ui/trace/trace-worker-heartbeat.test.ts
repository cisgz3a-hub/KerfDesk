// A trace never hands the worker's event loop back, so the only place a
// heartbeat can come from is inside the computation. The worker therefore
// drains the trace's own checkpoints and posts from them — without yielding,
// so the algorithm's order and the worker's blocked event loop are unchanged.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TraceSteps } from '../../core/trace/trace-steps';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

const mocks = vi.hoisted(() => ({
  trace: vi.fn(),
  bounds: vi.fn(() => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 })),
}));
vi.mock('../../core/trace', () => ({
  traceImageToColoredPaths: mocks.trace,
  boundsFromColoredPaths: mocks.bounds,
}));

const HEARTBEAT_INTERVAL_MS = 250;

type WorkerScope = {
  onmessage: ((event: MessageEvent<TraceWorkerRequest>) => void) | null;
  postMessage: (response: TraceWorkerResponse) => void;
};

function request(id: number): TraceWorkerRequest {
  return {
    id,
    image: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    options: {
      numberOfColors: 2,
      pathOmit: 0,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: false,
      fixedPalette: ['#ffffff', '#000000'],
    },
  };
}

/** A trace of `checkpoints` work units, recording the mode each one was asked for. */
function steppedTrace(checkpoints: number, modes: boolean[]): () => TraceSteps<string[]> {
  return function* run(): TraceSteps<string[]> {
    for (let index = 0; index < checkpoints; index += 1) {
      modes.push(yield);
    }
    return [];
  };
}

/** Advances a fake clock by `perStep` ms on every reading. */
function steppingClock(perStep: number): () => number {
  let now = 0;
  return () => {
    now += perStep;
    return now;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function runWorker(args: {
  readonly checkpoints: number;
  readonly msPerCheckpoint: number;
}): Promise<{ readonly posted: TraceWorkerResponse[]; readonly modes: boolean[] }> {
  const posted: TraceWorkerResponse[] = [];
  const modes: boolean[] = [];
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (response) => posted.push(response),
  };
  vi.spyOn(performance, 'now').mockImplementation(steppingClock(args.msPerCheckpoint));
  mocks.trace.mockImplementation(
    async (_image: unknown, _options: unknown, run: (steps: TraceSteps<string[]>) => string[]) =>
      run(steppedTrace(args.checkpoints, modes)()),
  );
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('./trace-worker');
  scope.onmessage?.({ data: request(7) } as MessageEvent<TraceWorkerRequest>);
  // The trace resolves on a microtask; let the worker's async body finish.
  await Promise.resolve();
  await Promise.resolve();
  return { posted, modes };
}

describe('trace worker heartbeat', () => {
  it('reports progress through a long trace and finishes with the result', async () => {
    // Twelve checkpoints, a second apart: a beat is due at every one after the
    // first interval has passed.
    const { posted, modes } = await runWorker({ checkpoints: 12, msPerCheckpoint: 1_000 });

    expect(posted[0]).toEqual({ id: 7, kind: 'started' });
    expect(posted.at(-1)).toMatchObject({ id: 7, kind: 'ok' });
    const beats = posted.filter((response) => response.kind === 'progress');
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((beat) => beat.id === 7)).toBe(true);
    // Checkpoints are requested, which is what gives the heartbeat somewhere
    // to run; the trace itself is drained straight through.
    expect(modes).toHaveLength(12);
    expect(modes.every((mode) => mode === true)).toBe(true);
  });

  it('stays silent through a trace that never reaches the interval', async () => {
    // Ten checkpoints one millisecond apart never reach 250 ms.
    const { posted } = await runWorker({ checkpoints: 10, msPerCheckpoint: 1 });

    expect(posted.map((response) => response.kind)).toEqual(['started', 'ok']);
  });

  it('beats no more than once per interval', async () => {
    const perCheckpoint = 100;
    const checkpoints = 30;
    const { posted } = await runWorker({ checkpoints, msPerCheckpoint: perCheckpoint });

    const beats = posted.filter((response) => response.kind === 'progress').length;
    // The clock only moves when a checkpoint reads it, so a beat can land no
    // sooner than the first checkpoint at or past the interval: one every
    // ceil(250 / 100) = 3 checkpoints, and never two in one interval.
    const checkpointsPerBeat = Math.ceil(HEARTBEAT_INTERVAL_MS / perCheckpoint);
    expect(beats).toBe(Math.floor(checkpoints / checkpointsPerBeat));
  });

  it('reports the failure instead of heartbeating forever when the trace throws', async () => {
    const posted: TraceWorkerResponse[] = [];
    const scope: WorkerScope = {
      onmessage: null,
      postMessage: (response) => posted.push(response),
    };
    mocks.trace.mockImplementation(async () => {
      throw new Error('traced geometry could not be represented');
    });
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./trace-worker');
    scope.onmessage?.({ data: request(8) } as MessageEvent<TraceWorkerRequest>);
    await Promise.resolve();
    await Promise.resolve();

    expect(posted).toEqual([
      { id: 8, kind: 'started' },
      { id: 8, kind: 'error', message: 'traced geometry could not be represented' },
    ]);
  });
});
