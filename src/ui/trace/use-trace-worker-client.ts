// Main-thread client that drives src/ui/trace/trace-worker.ts. Wraps
// the postMessage / onmessage protocol behind a Promise-returning API
// so callers see the same shape as the inline traceImageToColoredPaths
// function — the only difference is the work happens off-thread.
//
// Worker construction uses the standards-compliant
// `new Worker(new URL('./trace-worker.ts', import.meta.url),
// { type: 'module' })` pattern. Vite detects and code-splits the
// worker file as its own ES-module chunk. Outside a bundler (vitest,
// SSR, environments without Worker support) the construction throws.
// Small test-sized images can fall back inline; large images report a
// recoverable error instead of pinning the main thread.
//
// One worker is reused while it is healthy. A new trace supersedes an
// unfinished trace by rejecting its pending promise but KEEPS the worker
// alive: synchronous tracing code cannot process a cooperative cancellation
// message, so the stale job runs to completion inside the worker and its late
// response is dropped by request id (handleWorkerMessage ignores unknown ids).
// Tradeoff: the stale synchronous trace briefly occupies the worker and the
// new request queues behind it — still far cheaper than terminating and
// paying a cold worker spawn (plus the full unbundled ~85-module graph reload
// in Vite dev) for every 50-500ms preview trace during slider/preset tuning.
// Terminate is reserved for the fatal paths: worker runtime error, postMessage
// failure, and the 30s hung-worker timeout.
//
// Because that backlog is real, the worker acks kind:'started' when a request
// reaches the head of its message queue and the client restarts the 30s budget
// on that ack. The budget therefore bounds the worker's COMPUTE time for the
// request instead of compute-plus-backlog — a 4MP preview raster queued behind
// a superseded trace used to blow the budget and terminate a healthy worker.
// A worker that never acks is still bounded by the timer armed at post time.

import type { Bounds, ColoredPath } from '../../core/scene';
import {
  type RawImageData,
  type TraceOptions,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { hasAggressivePreprocessing, relaxAggressivePreprocessing } from './trace-options';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

export type TraceResult = {
  readonly paths: ColoredPath[];
  readonly bounds: Bounds;
  // Pixel grid whose coordinate space `paths` and `bounds` use. This is
  // intentionally carried with the result: preview tracing may run on a
  // downsampled working image, so callers cannot safely infer it from the
  // original imported raster.
  readonly width: number;
  readonly height: number;
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
  readonly resolve: (result: TraceResult) => void;
  readonly reject: (err: Error) => void;
  // Restart this request's hung-worker budget. Called on the worker's
  // 'started' ack, i.e. the moment the request stops queueing and starts
  // computing.
  readonly restartWatchdog: () => void;
};

// Clears / restarts the single timer that bounds one in-flight request.
type Watchdog = {
  readonly clear: () => void;
  readonly restart: () => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, Pending>();
const MAX_INLINE_TRACE_PIXELS = 160_000;
// Bound a worker request: a hung-but-alive worker (a pathological tracer loop)
// would otherwise leave the preview/commit UI pending forever. 30s is far past
// any legitimate trace of a budget-capped image (P2-A).
const TRACE_WORKER_TIMEOUT_MS = 30_000;

// Lazy-construct the worker. Returns null if the runtime doesn't have
// a Worker constructor (vitest without jsdom workers, SSR) or if a
// construction failed — callers fall back to the inline path for this
// call. A fatal worker runtime error retires that instance, but it
// must not poison the whole browser session: a stale deploy chunk or
// transient module load failure should be recoverable by trying a fresh
// Worker on the next trace.
//
// Uses the standards-compliant `new Worker(new URL('./trace-worker.ts',
// import.meta.url), { type: 'module' })` pattern. Vite recognises this
// and bundles the worker as a separate ES-module chunk automatically
// — no Vite-specific `?worker` suffix required. Falls through to the
// catch arm in non-bundler runtimes that can't resolve the worker URL.
function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    workerInstance = new Worker(new URL('./trace-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = (): void => {
      // Worker crashed (e.g. module-resolution failure, syntax error
      // in worker bundle). Same shape as a kind:'error' response —
      // reject every in-flight promise so callers can fall back.
      rejectAllPendingAndRetireWorker(
        new Error('Trace worker errored — falling back to inline tracing'),
      );
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<TraceWorkerResponse>): void {
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined) return;
  if (e.data.kind === 'started') {
    // The worker has dequeued this request and is about to trace it. Restart
    // the budget so the time it spent waiting behind a superseded trace (which
    // the worker has no way to cancel) is not charged to this request.
    pending.restartWatchdog();
    return;
  }
  pendingByRequestId.delete(e.data.id);
  if (e.data.kind === 'ok') {
    pending.resolve({
      paths: e.data.paths,
      bounds: e.data.bounds,
      width: e.data.width,
      height: e.data.height,
    });
    return;
  }
  // A kind:'error' response is scoped to this request. The worker
  // itself is still alive: retiring it here would make one bad trace
  // poison every later large-image trace for the whole app session.
  pending.reject(new Error(e.data.message));
}

// Tear down the live worker after a fatal runtime error. All callers
// that race the failure get their pending promises rejected. The next
// traceImage call will try to construct a fresh worker.
function retireWorker(): void {
  if (workerInstance !== null) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

// Reject every in-flight caller without touching the worker. Each pending's
// reject wrapper clears its own 30s timer, so a superseded request can never
// later terminate a worker that is busy with the request that replaced it.
function rejectAllPending(error: Error): void {
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  for (const pending of pendings) {
    pending.reject(error);
  }
}

function rejectAllPendingAndRetireWorker(error: Error): void {
  retireWorker();
  rejectAllPending(error);
}

// Trace via the worker if available, otherwise through the bounded
// inline fallback. Callers don't need to branch — the same Promise
// shape comes back either way for images small enough to run inline.
// The try/catch around traceInWorker is the second half of H6's fix:
// if the worker rejects (request-level trace error, or fatal worker
// death mid-flight), fall back to inline tracing for THIS call when it
// is small enough. Without it, every commit through the dialog would
// error-toast after a bounded inline path could have succeeded.
export async function traceImage(image: RawImageData, options: TraceOptions): Promise<TraceResult> {
  if (pendingByRequestId.size > 0) {
    // Supersede WITHOUT terminating: the stale job keeps the worker busy for
    // a moment and this request queues behind it, which is still far cheaper
    // than a cold worker restart per trace (see module header for the full
    // tradeoff). Its late response is dropped by id in handleWorkerMessage.
    rejectAllPending(new TraceRequestSupersededError());
  }
  const worker = ensureWorker();
  if (worker === null) {
    return traceInlineIfSafe(image, options);
  }
  try {
    return await traceInWorker(worker, image, options);
  } catch (err) {
    if (isTraceRequestSuperseded(err)) throw err;
    if (canTraceInline(image)) {
      return traceInline(image, options);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export function canTraceInline(image: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return image.width * image.height <= MAX_INLINE_TRACE_PIXELS;
}

async function traceInlineIfSafe(image: RawImageData, options: TraceOptions): Promise<TraceResult> {
  if (!canTraceInline(image)) {
    throw new Error(
      'Trace worker is unavailable for this large image. Reload the app and try again.',
    );
  }
  return traceInline(image, options);
}

async function traceInline(image: RawImageData, options: TraceOptions): Promise<TraceResult> {
  const paths = await traceImageToColoredPaths(image, options);
  return {
    paths,
    bounds: boundsFromColoredPaths(paths),
    width: image.width,
    height: image.height,
  };
}

// Bound one request. The budget is armed at post time so a worker that never
// speaks again (an old chunk with no 'started' ack, or one that dies before
// dequeuing) is still caught, and RESTARTED — not extended — when the worker
// acks that this request reached the head of its queue. Restarting is what
// makes the 30s measure compute rather than compute-plus-backlog: since
// supersede no longer terminates, an uncancellable stale trace can hold the
// worker for tens of seconds before the newest request is even looked at.
function armWatchdog(id: number): Watchdog {
  const fire = (): void => {
    // On timeout: terminate the shared worker and reject every pending caller.
    // A timed-out worker cannot answer sibling requests already queued to it.
    if (!pendingByRequestId.has(id)) return;
    rejectAllPendingAndRetireWorker(new Error('Trace worker timed out'));
  };
  let timer = setTimeout(fire, TRACE_WORKER_TIMEOUT_MS);
  return {
    clear: () => {
      clearTimeout(timer);
    },
    restart: () => {
      clearTimeout(timer);
      timer = setTimeout(fire, TRACE_WORKER_TIMEOUT_MS);
    },
  };
}

function traceInWorker(
  worker: Worker,
  image: RawImageData,
  options: TraceOptions,
): Promise<TraceResult> {
  return new Promise<TraceResult>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    const watchdog = armWatchdog(id);
    pendingByRequestId.set(id, {
      resolve: (result) => {
        watchdog.clear();
        resolve(result);
      },
      reject: (err) => {
        watchdog.clear();
        reject(err);
      },
      restartWatchdog: watchdog.restart,
    });
    // Keep the decoded source alive for subsequent preview changes, but move a
    // dedicated copy into the worker. Supplying its buffer as a transferable
    // avoids the browser making a second structured-clone copy during send.
    const transferredData = new Uint8ClampedArray(image.data);
    const request: TraceWorkerRequest = {
      id,
      image: { width: image.width, height: image.height, data: transferredData },
      options,
    };
    try {
      worker.postMessage(request, [transferredData.buffer]);
    } catch (err) {
      rejectAllPendingAndRetireWorker(new Error(traceWorkerSendErrorMessage(err)));
    }
  });
}

function traceWorkerSendErrorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Trace worker postMessage failed: ${detail}`;
}

// Higher-level wrapper used by every caller in the trace UI. Adds the
// H3 retry semantics (relax aggressive presets on zero-paths) on top
// of the raw traceImage() primitive, so the live preview and the
// commit path see the same result for the same input. Without this
// helper the preview would show "no paths" while commit silently
// succeeded after retrying — exactly the kind of divergence that
// makes users distrust the preview.
export async function traceImageWithFallback(
  image: RawImageData,
  options: TraceOptions,
): Promise<TraceResult> {
  const first = await traceImage(image, options);
  if (first.paths.length > 0) return first;
  if (!hasAggressivePreprocessing(options)) return first;
  // The first pass found nothing AND the preset stacks at least one
  // aggressive lever (Otsu / fixedPalette / despeckle). Drop those
  // three and trace again. If the relaxed pass also finds nothing,
  // we return its result; the input genuinely lacks contrast and the
  // caller's UI should communicate that.
  return traceImage(image, relaxAggressivePreprocessing(options));
}
