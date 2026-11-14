// Main-thread client that drives src/ui/trace/trace-worker.ts through
// trace-worker-transport.ts. Callers see the same Promise shape as the inline
// traceImageToColoredPaths function. Small images retain the supported
// cooperative inline fallback; large images retain their recoverable
// worker-unavailable error.
//
// The exported traceImage / traceImageWithFallback use the default client
// (the Trace Image dialog). createTraceWorkerClient makes another with its
// own worker, whose requests never supersede, and are never superseded by,
// the default client's (Multi-File Trace, ADR-431 Amendment 2026-11-14).

import {
  type RawImageData,
  type TraceOptions,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { resolveFrozenTraceSourceOptions } from '../../core/trace/trace-source-decisions';
import { hasAggressivePreprocessing, relaxAggressivePreprocessing } from './trace-options';
import { createCooperativeTraceRunner } from './cooperative-trace-runner';
import { collectTraceReports } from './trace-report-collector';
import type { TraceProgress } from '../../core/trace/trace-progress';
import {
  type ClientState,
  type TraceRequestFlags,
  type TraceResult,
  TraceRequestSupersededError,
  TraceWorkerRuntimeError,
  createClientState,
  ensureWorker,
  isTraceRequestSuperseded,
  retireWorker,
  supersedeClient,
  traceInWorker,
} from './trace-worker-transport';

export {
  TraceRequestSupersededError,
  isTraceRequestSuperseded,
  traceWorkerFailureMessage,
} from './trace-worker-transport';
export type { TraceRequestFlags, TraceResult } from './trace-worker-transport';

// The Trace Image dialog's client: its preview, commit and region traces.
const defaultClient = createClientState();
const MAX_INLINE_TRACE_PIXELS = 160_000;

// Trace via the worker if available, otherwise through the supported
// cooperative inline fallback. Callers don't need to branch — the same Promise
// shape comes back either way for images small enough to run inline.
// The try/catch around traceInWorker is the second half of H6's fix:
// if the worker rejects (request-level trace error, or fatal worker
// death mid-flight), fall back to inline tracing for THIS call when it
// is small enough. Without it, every commit through the dialog would
// error-toast after a bounded inline path could have succeeded.
export function traceImage(
  image: RawImageData,
  options: TraceOptions,
  signal?: AbortSignal,
  progress?: TraceProgress,
  flags: TraceRequestFlags = {},
): Promise<TraceResult> {
  return traceImageWithClient(defaultClient, image, options, signal, progress, flags);
}

async function traceImageWithClient(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  signal: AbortSignal | undefined,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  if (signal?.aborted === true) throw new TraceRequestSupersededError();
  const epoch = ++state.latestTraceEpoch;
  const cancel = (): void => {
    // A closing preview may outlive the replacement or commit that superseded
    // it. Only its own current computation can be cancelled by this signal.
    if (epoch !== state.latestTraceEpoch) return;
    state.latestTraceEpoch += 1;
    supersedeClient(state);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await traceImageForEpoch(
      state,
      image,
      options,
      epoch,
      (phase) => {
        if (epoch === state.latestTraceEpoch) progress?.(phase);
      },
      flags,
    );
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

async function traceImageForEpoch(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  supersedeClient(state);
  let worker = ensureWorker(state);
  // One fresh attempt can recover a transient constructor/module failure for
  // an image already supported by fallback. Persistent failure still computes
  // cooperatively; large-image error/retry boundaries are unchanged.
  if (worker === null && canTraceInline(image) && typeof Worker !== 'undefined') {
    worker = ensureWorker(state);
  }
  if (worker === null) {
    return traceInlineIfSafe(state, image, options, epoch, progress, flags);
  }
  try {
    return await traceInWorker(state, worker, image, options, progress, flags);
  } catch (err) {
    checkTraceEpoch(state, epoch);
    if (isTraceRequestSuperseded(err)) throw err;
    return recoverTrace(state, image, options, epoch, err, progress, flags);
  }
}

function checkTraceEpoch(state: ClientState, epoch: number): void {
  if (epoch !== state.latestTraceEpoch) throw new TraceRequestSupersededError();
}

async function recoverTrace(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
  error: unknown,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  // Request-level errors keep their existing fallback route. Only actual
  // runtime death gets one fresh worker attempt, at any image size, so a
  // transient worker death does not fail a large trace; it can never retry
  // forever. Small images then still have the cooperative inline route.
  let failure = error;
  if (error instanceof TraceWorkerRuntimeError) {
    const worker = ensureWorker(state);
    if (worker !== null) {
      try {
        return await traceInWorker(state, worker, image, options, progress, flags);
      } catch (retryError) {
        checkTraceEpoch(state, epoch);
        if (isTraceRequestSuperseded(retryError)) throw retryError;
        failure = retryError;
      }
    }
  }
  if (canTraceInline(image)) return traceInline(state, image, options, epoch, progress, flags);
  throw failure instanceof Error ? failure : new Error(String(failure));
}

export function canTraceInline(image: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return image.width * image.height <= MAX_INLINE_TRACE_PIXELS;
}

async function traceInlineIfSafe(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  if (!canTraceInline(image)) {
    throw new Error(
      'Trace worker is unavailable for this large image. Reload the app and try again.',
    );
  }
  return traceInline(state, image, options, epoch, progress, flags);
}

async function traceInline(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  epoch: number,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  // Inline tracing is bounded to small images, so resolving here is cheap.
  const traced =
    flags.freezeSourceDecisions === true
      ? resolveFrozenTraceSourceOptions(image, options)
      : options;
  const reports = collectTraceReports();
  const paths = await traceImageToColoredPaths(
    image,
    traced,
    createCooperativeTraceRunner(() => checkTraceEpoch(state, epoch), reports.add),
    progress,
  );
  checkTraceEpoch(state, epoch);
  return {
    paths,
    bounds: boundsFromColoredPaths(paths),
    width: image.width,
    height: image.height,
    ...(flags.freezeSourceDecisions === true ? { sourceOptions: traced } : {}),
    ...reports.entry(),
  };
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
  signal?: AbortSignal,
  progress?: TraceProgress,
  flags: TraceRequestFlags = {},
): Promise<TraceResult> {
  return traceWithClientFallback(defaultClient, image, options, signal, progress, flags);
}

function traceWithClientFallback(
  state: ClientState,
  image: RawImageData,
  options: TraceOptions,
  signal: AbortSignal | undefined,
  progress: TraceProgress | undefined,
  flags: TraceRequestFlags,
): Promise<TraceResult> {
  return traceWithRelaxedRetry(
    (passOptions, passFlags) =>
      traceImageWithClient(state, image, passOptions, signal, progress, passFlags),
    options,
    flags,
  );
}

/** A trace client with its own worker, which no other client's request supersedes. */
export type TraceWorkerClient = {
  /** As traceImageWithFallback, on this client's own worker. */
  readonly traceImageWithFallback: (
    image: RawImageData,
    options: TraceOptions,
    signal?: AbortSignal,
  ) => Promise<TraceResult>;
  /** Ends this client's work and terminates its worker. */
  readonly dispose: () => void;
};

/**
 * A separate trace client for background work (Multi-File Trace). Its requests
 * supersede only each other, so the Trace Image dialog's preview and commit on
 * the default client neither interrupt it nor are interrupted by it.
 */
export function createTraceWorkerClient(): TraceWorkerClient {
  const state = createClientState();
  return {
    traceImageWithFallback: (image, options, signal) =>
      traceWithClientFallback(state, image, options, signal, undefined, {}),
    dispose: () => {
      state.latestTraceEpoch += 1;
      supersedeClient(state);
      const worker = state.workerInstance;
      if (worker !== null) retireWorker(state, worker);
    },
  };
}

/**
 * The same first pass and relaxed-settings retry as traceImageWithFallback,
 * traced in the calling thread at any image size. For headless callers (the
 * trace command under Node) that have no Worker and no UI thread to keep
 * responsive, so the app's inline-size bound does not apply to them.
 */
export async function traceImageInThreadWithFallback(
  image: RawImageData,
  options: TraceOptions,
): Promise<TraceResult> {
  return traceWithRelaxedRetry(async (passOptions) => {
    const paths = await traceImageToColoredPaths(image, passOptions);
    return {
      paths,
      bounds: boundsFromColoredPaths(paths),
      width: image.width,
      height: image.height,
    };
  }, options);
}

type TracePass = (options: TraceOptions, flags: TraceRequestFlags) => Promise<TraceResult>;

async function traceWithRelaxedRetry(
  pass: TracePass,
  options: TraceOptions,
  flags: TraceRequestFlags = {},
): Promise<TraceResult> {
  const first = await pass(options, flags);
  if (first.paths.length > 0) return first;
  if (!hasAggressivePreprocessing(options)) return first;
  // Keep the same palette/backend and disclose that Otsu, ink despeckle,
  // and short-path filtering were relaxed. Preview and commit carry this
  // result together so recovered artwork never masquerades as the first pass.
  // A frozen first pass hands the retry its resolved decisions, and its
  // unrelaxed options stay the ones any derived pass inherits.
  const retried = await pass(relaxAggressivePreprocessing(first.sourceOptions ?? options), {});
  return {
    ...retried,
    notices: ['relaxed-settings'],
    ...(first.sourceOptions === undefined ? {} : { sourceOptions: first.sourceOptions }),
  };
}
