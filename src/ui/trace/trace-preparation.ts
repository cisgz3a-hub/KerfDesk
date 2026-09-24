import type { RawImageData } from '../../core/trace';
import type { TracePhase } from '../../core/trace/trace-progress';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { traceBoundaryForWorkingGrid } from './trace-boundary-grid';
import { checkTraceSignal, traceAbortError } from './trace-cancellation';
import type { PendingPreparedTrace, TracePreparationRequest } from './prepared-trace';
import type { TraceResult } from './use-trace-worker-client';
import type { TracePreviewSettlement } from './use-trace-preview-settlement';

export type DecodedTraceImage = { readonly img: RawImageData; readonly hasTransparency: boolean };
export type TracePreparation = PendingPreparedTrace & {
  readonly failed: boolean;
  readonly result: Promise<TraceResult>;
  readonly cancel: () => void;
  readonly settle: (outcome: TracePreviewSettlement) => void;
};

/** One computation shared by preview and Submit, including decode and debounce. */
export function createTracePreparation(
  request: TracePreparationRequest,
  decoded: Promise<DecodedTraceImage>,
  delay: number,
  tracing: (image: DecodedTraceImage, phase: TracePhase) => void,
): TracePreparation {
  const cancellation = new AbortController();
  let started = false;
  let settled = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (value: TraceResult) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<TraceResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Requests can be replaced before any consumer attaches. Keep rejection owned.
  void result.catch(() => undefined);
  const settle = (outcome: TracePreviewSettlement): void => {
    if (settled) return;
    settled = true;
    failed = outcome.kind === 'error';
    clearTimeout(timer);
    if (outcome.kind === 'ready') resolve(outcome.result);
    else reject(outcome.error);
    cancellation.abort();
  };
  const cancel = (): void => settle({ kind: 'error', error: traceAbortError() });
  const start = (): void => {
    if (started || settled) return;
    started = true;
    clearTimeout(timer);
    void prepare(request, decoded, cancellation.signal, tracing).then(
      (value) => settle({ kind: 'ready', result: value }),
      (error: unknown) => settle({ kind: 'error', error }),
    );
  };
  if (delay === 0) start();
  else timer = setTimeout(start, delay);
  return {
    request,
    result,
    cancel,
    settle,
    get failed() {
      return failed;
    },
    consume: async (signal) => {
      checkTraceSignal(signal);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        start();
        return await result;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

async function prepare(
  request: TracePreparationRequest,
  decoded: Promise<DecodedTraceImage>,
  signal: AbortSignal,
  tracing: (image: DecodedTraceImage, phase: TracePhase) => void,
): Promise<TraceResult> {
  const image = await decoded;
  checkTraceSignal(signal);
  tracing(image, 'preparing');
  const boundary = traceBoundaryForWorkingGrid(request.boundary, request.sourceGrid, image.img);
  return traceImageWithBoundaryMode(
    image.img,
    request.options,
    boundary,
    request.boundaryMode,
    signal,
    (phase) => tracing(image, phase),
  );
}
