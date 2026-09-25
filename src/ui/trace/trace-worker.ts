// Web Worker that runs the trace pipeline off the main thread.
// Receives a RawImageData + TraceOptions, returns ColoredPath[].
// Preserves UI responsiveness during the 50-500ms preprocess+trace
// window on larger inputs.
//
// The work itself is identical to traceImageToColoredPaths in
// trace-to-paths.ts (we share the pure-core preprocessing helpers and
// the tracedata-to-ColoredPath converter). The wrinkle is that the
// worker has its own module-load + tracer-cache lifecycle, separate
// from the main thread's, so a heavy import only happens once per
// worker instance (the live preview reuses the same worker across
// preset changes).
//
// Vite loads this from the direct
// `new Worker(new URL('./trace-worker.ts', import.meta.url), { type: 'module' })`
// expression in use-trace-worker-client.ts. That call-site shape is
// what makes Vite bundle the worker instead of shipping raw TS.

/// <reference lib="webworker" />

import type { Bounds, ColoredPath } from '../../core/scene';
import {
  type RawImageData,
  type TraceOptions,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { resolveFrozenTraceSourceOptions } from '../../core/trace/trace-source-decisions';
import type { TraceSteps } from '../../core/trace/trace-steps';
import type { TracePhase, TraceProgress } from '../../core/trace/trace-progress';

export type TraceWorkerRequest = {
  readonly id: number;
  readonly image: RawImageData;
  readonly options: TraceOptions;
  // Region Enhance (ADR-410): resolve the whole source's binarisation
  // decisions here, trace with them, and send them back so the boxed crop
  // re-trace can reuse them. Resolving them costs up to a full-image median
  // plus a histogram, which must not run on the UI thread.
  readonly freezeSourceDecisions?: boolean;
};

// A trace never hands the worker's event loop back, so a heartbeat can only
// come from inside the computation. The resumable TraceSteps generators return
// to their runner often enough on their own: measured on dense line art, the
// native drain reaches the runner 180k-9.8M times with a worst-case silence of
// 3.3 s, against this budget's 30 s. Posting from there does not yield, so the
// trace runs exactly as runTraceSteps ran it.
const HEARTBEAT_INTERVAL_MS = 250;

export type TraceWorkerResponse =
  // Sent before any tracing work for this id begins. The worker dispatches
  // queued messages one at a time, so this ack marks the moment the request
  // stops waiting and starts computing — the client restarts its hung-worker
  // budget here so queue time behind an uncancellable superseded trace is
  // never charged to a healthy request.
  | { readonly id: number; readonly kind: 'started' }
  // Still computing. The client's budget bounds SILENCE, not total work: a
  // dense line drawing legitimately traces for minutes, and a fixed execution
  // deadline killed it and showed the operator "Trace worker timed out" for
  // artwork that was never going to finish inside it.
  | { readonly id: number; readonly kind: 'progress'; readonly phase?: TracePhase }
  | {
      readonly id: number;
      readonly kind: 'ok';
      readonly paths: ColoredPath[];
      readonly bounds: Bounds;
      readonly width: number;
      readonly height: number;
      // The options this trace ran with, present when the request asked for
      // freezeSourceDecisions.
      readonly sourceOptions?: TraceOptions;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

self.onmessage = (e: MessageEvent<TraceWorkerRequest>): void => {
  const { id, image, options, freezeSourceDecisions } = e.data;
  // Ack before any tracing work. Message events are dispatched one at a time
  // and the trace that follows never yields the worker's event loop back, so
  // reaching this line IS the start of this request's compute — which is what
  // the client's hung-worker budget must measure. Without it a request that
  // queued behind a superseded (uncancellable) trace was killed for the
  // backlog's latency, terminating a healthy worker mid-preview.
  const startedAck: TraceWorkerResponse = { id, kind: 'started' };
  self.postMessage(startedAck);
  void (async (): Promise<void> => {
    try {
      const traced =
        freezeSourceDecisions === true ? resolveFrozenTraceSourceOptions(image, options) : options;
      const paths = await traceImageToColoredPaths(
        image,
        traced,
        heartbeatRunner(id),
        phaseReporter(id),
      );
      const bounds = boundsFromColoredPaths(paths);
      const response: TraceWorkerResponse = {
        id,
        kind: 'ok',
        paths,
        bounds,
        width: image.width,
        height: image.height,
        ...(freezeSourceDecisions === true ? { sourceOptions: traced } : {}),
      };
      self.postMessage(response);
    } catch (err) {
      const response: TraceWorkerResponse = {
        id,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(response);
    }
  })();
};

function phaseReporter(id: number): TraceProgress {
  let previous: TracePhase | undefined;
  return (phase) => {
    if (phase === previous) return;
    previous = phase;
    const response: TraceWorkerResponse = { id, kind: 'progress', phase };
    self.postMessage(response);
  };
}

/**
 * Drain the trace exactly as runTraceSteps does, reporting that it is alive.
 *
 * The execution mode stays `false`: cooperative checkpoints would add an inner
 * yield to every hot loop, measured at 6% on dense Line Art and 18% on Edge
 * Detection, and they are not needed — the generators already return to their
 * runner at each entry and delegation boundary, far inside the silence budget.
 * Nothing here awaits, so the worker's event loop stays blocked as before; a
 * blocked worker can still post, because delivery does not need it to yield.
 */
function heartbeatRunner(id: number): <T>(steps: TraceSteps<T>) => T {
  let due = performance.now() + HEARTBEAT_INTERVAL_MS;
  return <T>(steps: TraceSteps<T>): T => {
    for (;;) {
      const step = steps.next(false);
      if (step.done) return step.value;
      const now = performance.now();
      if (now < due) continue;
      due = now + HEARTBEAT_INTERVAL_MS;
      const beat: TraceWorkerResponse = { id, kind: 'progress' };
      self.postMessage(beat);
    }
  };
}
