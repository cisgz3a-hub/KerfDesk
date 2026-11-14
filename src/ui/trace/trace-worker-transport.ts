// The trace worker transport behind use-trace-worker-client.ts: one client's
// worker, its pending requests and its watchdog. Wraps the postMessage /
// onmessage protocol of src/ui/trace/trace-worker.ts behind promises.
//
// Worker construction uses the standards-compliant
// `new Worker(new URL('./trace-worker.ts', import.meta.url),
// { type: 'module' })` pattern. Vite detects and code-splits the
// worker file as its own ES-module chunk. Outside a bundler (vitest,
// SSR, environments without Worker support) the construction throws.
//
// Reuse a healthy worker after its request completes. Superseding unfinished
// work retires that worker: synchronous tracing cannot process a cancellation
// message, and keeping it alive queues the newest request behind obsolete CPU
// work (TR-020). Supersession rejects only the obsolete promise, without inline
// fallback or relaxed retry. The replacement pays worker startup, not backlog.
//
// Each message, fatal callback and watchdog belongs to its specific worker.
// Retired callbacks cannot act on a replacement. The 30s watchdog bounds
// SILENCE: it is armed at post time, restarted on the 'started' ack, and
// restarted again on every heartbeat the worker sends from inside the trace.
// A worker that is merely slow keeps its budget; one that has stopped speaking
// does not.
//
// All of this is per client (ClientState): a request supersedes only the
// requests of its own client (ADR-431 Amendment 2026-11-14).

import type { Bounds, ColoredPath } from '../../core/scene';
import type { RawImageData, TraceOptions } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
import { createCooperativeTraceRunner } from './cooperative-trace-runner';
import type { TraceReport } from '../../core/trace/trace-steps';
import type { TraceNotice } from './trace-notices';
import type { TraceProgress } from '../../core/trace/trace-progress';
import { LAZY_LOAD_FAILURE_ADVICE } from '../common/lazy-load-failure';
import { unpackTracePathsSteps } from './trace-result-transfer';

export type TraceResult = {
  readonly paths: ColoredPath[];
  readonly bounds: Bounds;
  // Pixel grid whose coordinate space `paths` and `bounds` use. This is
  // intentionally carried with the result: preview tracing may run on a
  // downsampled working image, so callers cannot safely infer it from the
  // original imported raster.
  readonly width: number;
  readonly height: number;
  readonly notices?: ReadonlyArray<TraceNotice>;
  // Submit's fallback decoder can recover source metadata before any crop.
  readonly sourceHasTransparency?: boolean;
  // The options the first pass traced with, the whole source's binarisation
  // decisions resolved into them. Present exactly when the request asked for
  // freezeSourceDecisions (ADR-435).
  readonly sourceOptions?: TraceOptions;
  // What automatic detection chose on this grid, for display only (the
  // automatic threshold, Line Art's route). A relaxed retry carries its own.
  readonly report?: TraceReport;
};

/** Per-request switches that are not trace settings. */
export type TraceRequestFlags = {
  // Run resolveFrozenTraceSourceOptions next to the trace (in the worker when
  // there is one), trace with its result and return that as sourceOptions.
  readonly freezeSourceDecisions?: boolean;
};

export class TraceRequestSupersededError extends Error {
  override readonly name = 'TraceRequestSupersededError';

  constructor() {
    super('Trace request superseded by a newer request');
  }
}

export function isTraceRequestSuperseded(error: unknown): boolean {
  return error instanceof TraceRequestSupersededError;
}

type Pending = {
  readonly worker: Worker;
  readonly resolve: (result: TraceResult) => void;
  readonly reject: (err: Error) => void;
  // Restart this request's hung-worker budget. Called on the worker's
  // 'started' ack — the moment the request stops queueing and starts
  // computing — and on every heartbeat from inside that computation.
  readonly restartWatchdog: () => void;
  readonly progress: TraceProgress | undefined;
};

// Clears / restarts the single timer that bounds one in-flight request.
type Watchdog = {
  readonly clear: () => void;
  readonly restart: () => void;
};

// One client's worker and its requests. A newer request supersedes only the
// requests of its own client: the Trace Image dialog uses the default client,
// and each Multi-File Trace makes its own, so neither ever supersedes the
// other (ADR-431 Amendment 2026-11-14).
export type ClientState = {
  workerInstance: Worker | null;
  latestTraceEpoch: number;
  readonly pendingByRequestId: Map<number, Pending>;
  // Requests whose result has arrived and is being unpacked in slices. Their
  // worker is idle again, so superseding one rejects it without retiring it.
  readonly unpackingByRequestId: Map<number, Pending>;
};

export function createClientState(): ClientState {
  return {
    workerInstance: null,
    latestTraceEpoch: 0,
    pendingByRequestId: new Map(),
    unpackingByRequestId: new Map(),
  };
}

let nextRequestId = 0;
// How long a request may go without a word from its worker before that worker
// is treated as dead. It bounds SILENCE, not work: the worker heartbeats from
// inside the trace every 250 ms, so a dense line drawing that legitimately
// traces for minutes keeps its budget, while a worker that has crashed,
// wedged, or never started still fails here. It used to bound total execution,
// which made it a size refusal in disguise — a 600px coloring-page rosette
// grid traces in about 19 s, so a page-sized one was abandoned mid-work and
// reported to the operator as "Trace worker timed out" (rule 7 / ADR-241).
const TRACE_WORKER_SILENCE_MS = 30_000;

export class TraceWorkerRuntimeError extends Error {}

// A worker whose script never loaded gets a plain `error` Event with no
// message (measured in Chromium on a 404 module worker). Typically the window
// still runs the previous build after an Update in another window, so the
// hashed worker chunk is gone. An uncaught exception inside a loaded worker
// arrives as an ErrorEvent carrying "Uncaught ...".
export function traceWorkerFailureMessage(event: unknown): string {
  const detail = (event as { readonly message?: unknown } | undefined)?.message;
  if (typeof detail === 'string' && detail.length > 0) {
    return `The tracing engine stopped unexpectedly (${detail}). Try the trace again.`;
  }
  return `The tracing engine could not load. ${LAZY_LOAD_FAILURE_ADVICE}`;
}

// Lazy-construct the worker. Returns null if the runtime doesn't have
// a Worker constructor (vitest without jsdom workers, SSR) or if a
// construction failed. Small-image callers try one fresh worker after a
// construction failure or runtime death, then use cooperative fallback.
// Failure never poisons later requests: each can construct a fresh worker.
//
// Uses the standards-compliant `new Worker(new URL('./trace-worker.ts',
// import.meta.url), { type: 'module' })` pattern. Vite recognises this
// and bundles the worker as a separate ES-module chunk automatically
// — no Vite-specific `?worker` suffix required. Falls through to the
// catch arm in non-bundler runtimes that can't resolve the worker URL.
export function ensureWorker(state: ClientState): Worker | null {
  if (state.workerInstance !== null) return state.workerInstance;
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    const worker = new Worker(new URL('./trace-worker.ts', import.meta.url), {
      type: 'module',
    });
    state.workerInstance = worker;
    worker.onmessage = (event): void => handleWorkerMessage(state, worker, event);
    worker.onerror = (event): void => {
      // Worker crashed (e.g. module-resolution failure, syntax error
      // in worker bundle). Same shape as a kind:'error' response —
      // reject every in-flight promise so callers can fall back.
      rejectAllPendingAndRetireWorker(
        state,
        worker,
        new TraceWorkerRuntimeError(traceWorkerFailureMessage(event)),
      );
    };
    return worker;
  } catch {
    return null;
  }
}

function handleWorkerMessage(
  state: ClientState,
  worker: Worker,
  e: MessageEvent<TraceWorkerResponse>,
): void {
  if (state.workerInstance !== worker) return;
  const pending = state.pendingByRequestId.get(e.data.id);
  if (pending === undefined || pending.worker !== worker) return;
  if (e.data.kind === 'started' || e.data.kind === 'progress') {
    // 'started': startup completed and this owner is about to trace this
    // request. 'progress': it is still inside that trace. Either way the
    // worker has just proved it is alive, which is the only thing the budget
    // below is entitled to judge.
    pending.restartWatchdog();
    if (e.data.kind === 'progress' && e.data.phase !== undefined) pending.progress?.(e.data.phase);
    return;
  }
  state.pendingByRequestId.delete(e.data.id);
  if (e.data.kind === 'ok') {
    settleTraceResult(state.unpackingByRequestId, e.data.id, pending, e.data);
    return;
  }
  // A kind:'error' response is scoped to this request. The worker
  // itself is still alive: retiring it here would make one bad trace
  // poison every later large-image trace for the whole app session.
  pending.reject(new Error(e.data.message));
}

type TraceWorkerResult = Extract<TraceWorkerResponse, { readonly kind: 'ok' }>;

// A packed result is rebuilt in short slices, so a dense trace never holds the
// UI thread for the whole result at once (trace-result-transfer.ts).
function settleTraceResult(
  unpackingByRequestId: Map<number, Pending>,
  id: number,
  pending: Pending,
  data: TraceWorkerResult,
): void {
  const resolve = (paths: ColoredPath[]): void =>
    pending.resolve({
      paths,
      bounds: data.bounds,
      width: data.width,
      height: data.height,
      ...(data.sourceOptions === undefined ? {} : { sourceOptions: data.sourceOptions }),
      ...(data.report === undefined ? {} : { report: data.report }),
    });
  if (data.packedPaths === undefined) {
    resolve(data.paths ?? []);
    return;
  }
  unpackingByRequestId.set(id, pending);
  const current = (): boolean => unpackingByRequestId.get(id) === pending;
  const unpack = createCooperativeTraceRunner(() => {
    if (!current()) throw new TraceRequestSupersededError();
  });
  void Promise.resolve(unpack(unpackTracePathsSteps(data.packedPaths))).then(
    (paths) => {
      if (!current()) return;
      unpackingByRequestId.delete(id);
      resolve(paths);
    },
    (error: unknown) => {
      if (!current()) return;
      unpackingByRequestId.delete(id);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    },
  );
}

function rejectUnpacking(state: ClientState, error: Error): void {
  const pendings = Array.from(state.unpackingByRequestId.values());
  state.unpackingByRequestId.clear();
  for (const pending of pendings) pending.reject(error);
}

// Tear down the live worker after a fatal runtime error. All callers
// that race the failure get their pending promises rejected. The next
// traceImage call will try to construct a fresh worker.
export function retireWorker(state: ClientState, worker: Worker): void {
  state.workerInstance = null;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
}

// Reject every in-flight caller without touching the worker. Each pending's
// reject wrapper clears its own 30s timer, so a superseded request can never
// later terminate a worker that is busy with the request that replaced it.
function rejectAllPending(state: ClientState, error: Error): void {
  const pendings = Array.from(state.pendingByRequestId.values());
  state.pendingByRequestId.clear();
  for (const pending of pendings) {
    pending.reject(error);
  }
}

function rejectAllPendingAndRetireWorker(state: ClientState, worker: Worker, error: Error): void {
  if (state.workerInstance !== worker) return;
  retireWorker(state, worker);
  rejectAllPending(state, error);
}

// Supersede every request of this client: unpacking results are dropped and a
// busy worker is retired (TR-020).
export function supersedeClient(state: ClientState): void {
  rejectUnpacking(state, new TraceRequestSupersededError());
  if (state.workerInstance !== null && state.pendingByRequestId.size > 0) {
    rejectAllPendingAndRetireWorker(state, state.workerInstance, new TraceRequestSupersededError());
  }
}

// Bound one request. The budget is armed at post time so a worker that never
// speaks again is still caught, and restarted when that owner acknowledges
// the request. Both the request and worker identity must still be current.
function armWatchdog(state: ClientState, worker: Worker, id: number): Watchdog {
  const fire = (): void => {
    if (state.pendingByRequestId.get(id)?.worker !== worker) return;
    rejectAllPendingAndRetireWorker(state, worker, new Error('Trace worker timed out'));
  };
  let timer = setTimeout(fire, TRACE_WORKER_SILENCE_MS);
  return {
    clear: () => {
      clearTimeout(timer);
    },
    restart: () => {
      clearTimeout(timer);
      timer = setTimeout(fire, TRACE_WORKER_SILENCE_MS);
    },
  };
}

export function traceInWorker(
  state: ClientState,
  worker: Worker,
  image: RawImageData,
  options: TraceOptions,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  return new Promise<TraceResult>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    const watchdog = armWatchdog(state, worker, id);
    state.pendingByRequestId.set(id, {
      worker,
      resolve: (result) => {
        watchdog.clear();
        resolve(result);
      },
      reject: (err) => {
        watchdog.clear();
        reject(err);
      },
      restartWatchdog: watchdog.restart,
      progress,
    });
    // Keep the decoded source alive for subsequent preview changes, but move a
    // dedicated copy into the worker. Supplying its buffer as a transferable
    // avoids the browser making a second structured-clone copy during send.
    const transferredData = new Uint8ClampedArray(image.data);
    const request: TraceWorkerRequest = {
      id,
      image: { ...image, width: image.width, height: image.height, data: transferredData },
      options,
      ...(flags.freezeSourceDecisions === true ? { freezeSourceDecisions: true } : {}),
    };
    try {
      worker.postMessage(request, [transferredData.buffer]);
    } catch (err) {
      rejectAllPendingAndRetireWorker(state, worker, new Error(traceWorkerSendErrorMessage(err)));
    }
  });
}

function traceWorkerSendErrorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Trace worker postMessage failed: ${detail}`;
}
