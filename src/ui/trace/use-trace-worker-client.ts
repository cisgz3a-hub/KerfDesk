// Main-thread client that drives src/ui/trace/trace-worker.ts. Wraps
// the postMessage / onmessage protocol behind a Promise-returning API
// so callers see the same shape as the inline traceImageToColoredPaths
// function. Supported inline fallback uses cooperative tracing checkpoints.
//
// Worker construction uses the standards-compliant
// `new Worker(new URL('./trace-worker.ts', import.meta.url),
// { type: 'module' })` pattern. Vite detects and code-splits the
// worker file as its own ES-module chunk. Outside a bundler (vitest,
// SSR, environments without Worker support) the construction throws.
// Small images retain the existing inline fallback; large images retain their
// recoverable worker-unavailable error.
//
// Reuse a healthy worker after its request completes. Superseding unfinished
// work retires that worker: synchronous tracing cannot process a cancellation
// message, and keeping it alive queues the newest request behind obsolete CPU
// work (TR-020). Supersession rejects only the obsolete promise, without inline
// fallback or relaxed retry. The replacement pays worker startup, not backlog.
//
// Each message, fatal callback and watchdog belongs to its specific worker.
// Retired callbacks cannot act on a replacement. The unchanged 30s watchdog
// bounds startup/no acknowledgement, then restarts on the 'started' ack to
// give the current computation its own budget.

import type { Bounds, ColoredPath } from '../../core/scene';
import {
  type RawImageData,
  type TraceOptions,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { hasAggressivePreprocessing, relaxAggressivePreprocessing } from './trace-options';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
import { createCooperativeTraceRunner } from './cooperative-trace-runner';
import type { TraceNotice } from './trace-notices';

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
let latestTraceEpoch = 0;
const pendingByRequestId = new Map<number, Pending>();
const MAX_INLINE_TRACE_PIXELS = 160_000;
// Bound a worker request so excessive computation cannot leave preview/commit
// pending forever. This is an execution deadline, not a complexity guarantee:
// valid artwork can still expose a slow algorithm despite a capped pixel grid.
const TRACE_WORKER_TIMEOUT_MS = 30_000;

class TraceWorkerRuntimeError extends Error {}

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
function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    const worker = new Worker(new URL('./trace-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event): void => handleWorkerMessage(worker, event);
    worker.onerror = (): void => {
      // Worker crashed (e.g. module-resolution failure, syntax error
      // in worker bundle). Same shape as a kind:'error' response —
      // reject every in-flight promise so callers can fall back.
      rejectAllPendingAndRetireWorker(
        worker,
        new TraceWorkerRuntimeError('Trace worker errored — falling back to inline tracing'),
      );
    };
    return worker;
  } catch {
    return null;
  }
}

function handleWorkerMessage(worker: Worker, e: MessageEvent<TraceWorkerResponse>): void {
  if (workerInstance !== worker) return;
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined || pending.worker !== worker) return;
  if (e.data.kind === 'started') {
    // Startup completed and this owner is about to trace the current request.
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
function retireWorker(worker: Worker): void {
  workerInstance = null;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
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

function rejectAllPendingAndRetireWorker(worker: Worker, error: Error): void {
  if (workerInstance !== worker) return;
  retireWorker(worker);
  rejectAllPending(error);
}

// Trace via the worker if available, otherwise through the supported
// cooperative inline fallback. Callers don't need to branch — the same Promise
// shape comes back either way for images small enough to run inline.
// The try/catch around traceInWorker is the second half of H6's fix:
// if the worker rejects (request-level trace error, or fatal worker
// death mid-flight), fall back to inline tracing for THIS call when it
// is small enough. Without it, every commit through the dialog would
// error-toast after a bounded inline path could have succeeded.
export async function traceImage(image: RawImageData, options: TraceOptions): Promise<TraceResult> {
  const epoch = ++latestTraceEpoch;
  if (workerInstance !== null && pendingByRequestId.size > 0) {
    rejectAllPendingAndRetireWorker(workerInstance, new TraceRequestSupersededError());
  }
  let worker = ensureWorker();
  // One fresh attempt can recover a transient constructor/module failure for
  // an image already supported by fallback. Persistent failure still computes
  // cooperatively; large-image error/retry boundaries are unchanged.
  if (worker === null && canTraceInline(image) && typeof Worker !== 'undefined') {
    worker = ensureWorker();
  }
  if (worker === null) {
    return traceInlineIfSafe(image, options, epoch);
  }
  try {
    return await traceInWorker(worker, image, options);
  } catch (err) {
    checkTraceEpoch(epoch);
    if (isTraceRequestSuperseded(err)) throw err;
    if (canTraceInline(image)) {
      return recoverSmallTrace(image, options, epoch, err);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function checkTraceEpoch(epoch: number): void {
  if (epoch !== latestTraceEpoch) throw new TraceRequestSupersededError();
}

async function recoverSmallTrace(
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
  error: unknown,
): Promise<TraceResult> {
  // Request-level errors keep their existing fallback route. Only actual
  // runtime death gets one fresh worker attempt; it can never retry forever.
  if (error instanceof TraceWorkerRuntimeError) {
    const worker = ensureWorker();
    if (worker !== null) {
      try {
        return await traceInWorker(worker, image, options);
      } catch (retryError) {
        checkTraceEpoch(epoch);
        if (isTraceRequestSuperseded(retryError)) throw retryError;
      }
    }
  }
  return traceInline(image, options, epoch);
}

export function canTraceInline(image: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return image.width * image.height <= MAX_INLINE_TRACE_PIXELS;
}

async function traceInlineIfSafe(
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
): Promise<TraceResult> {
  if (!canTraceInline(image)) {
    throw new Error(
      'Trace worker is unavailable for this large image. Reload the app and try again.',
    );
  }
  return traceInline(image, options, epoch);
}

async function traceInline(
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
): Promise<TraceResult> {
  const paths = await traceImageToColoredPaths(
    image,
    options,
    createCooperativeTraceRunner(() => checkTraceEpoch(epoch)),
  );
  checkTraceEpoch(epoch);
  return {
    paths,
    bounds: boundsFromColoredPaths(paths),
    width: image.width,
    height: image.height,
  };
}

// Bound one request. The budget is armed at post time so a worker that never
// speaks again is still caught, and restarted when that owner acknowledges
// the request. Both the request and worker identity must still be current.
function armWatchdog(worker: Worker, id: number): Watchdog {
  const fire = (): void => {
    if (pendingByRequestId.get(id)?.worker !== worker) return;
    rejectAllPendingAndRetireWorker(worker, new Error('Trace worker timed out'));
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
    const watchdog = armWatchdog(worker, id);
    pendingByRequestId.set(id, {
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
      rejectAllPendingAndRetireWorker(worker, new Error(traceWorkerSendErrorMessage(err)));
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
  // Keep the same palette/backend and disclose that Otsu, ink despeckle,
  // and short-path filtering were relaxed. Preview and commit carry this
  // result together so recovered artwork never masquerades as the first pass.
  const retried = await traceImage(image, relaxAggressivePreprocessing(options));
  return { ...retried, notices: ['relaxed-settings'] };
}
