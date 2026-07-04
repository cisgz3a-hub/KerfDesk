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
// One worker per app lifetime — cheaper than spawning per-trace
// because imagetracerjs's lazy load only pays its cost once. The
// pending-promise map keys responses by an incrementing request id
// so overlapping calls (debounced preview re-traces) don't crosstalk.

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
};

type Pending = {
  readonly resolve: (result: TraceResult) => void;
  readonly reject: (err: Error) => void;
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
      const pendings = Array.from(pendingByRequestId.values());
      pendingByRequestId.clear();
      retireWorker();
      for (const p of pendings) {
        p.reject(new Error('Trace worker errored — falling back to inline tracing'));
      }
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<TraceWorkerResponse>): void {
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined) return;
  pendingByRequestId.delete(e.data.id);
  if (e.data.kind === 'ok') {
    pending.resolve({ paths: e.data.paths, bounds: e.data.bounds });
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

function rejectAllPendingAndRetireWorker(message: string): void {
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  retireWorker();
  for (const pending of pendings) {
    pending.reject(new Error(message));
  }
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
  const worker = ensureWorker();
  if (worker === null) {
    return traceInlineIfSafe(image, options);
  }
  try {
    return await traceInWorker(worker, image, options);
  } catch (err) {
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
  return { paths, bounds: boundsFromColoredPaths(paths) };
}

function traceInWorker(
  worker: Worker,
  image: RawImageData,
  options: TraceOptions,
): Promise<TraceResult> {
  return new Promise<TraceResult>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    // On timeout: terminate the shared worker and reject every pending caller.
    // A timed-out worker cannot answer sibling requests already queued to it.
    const timer = setTimeout(() => {
      if (!pendingByRequestId.has(id)) return;
      rejectAllPendingAndRetireWorker('Trace worker timed out');
    }, TRACE_WORKER_TIMEOUT_MS);
    pendingByRequestId.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    const request: TraceWorkerRequest = { id, image, options };
    try {
      worker.postMessage(request);
    } catch (err) {
      rejectAllPendingAndRetireWorker(traceWorkerSendErrorMessage(err));
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
