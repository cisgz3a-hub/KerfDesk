import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { PREVIEW_MAX_EDGE_PX, loadImageAsRawData } from './image-loader';
import type { TracePreparationRequest } from './prepared-trace';
import { rawImageHasTransparency } from './raw-image-transparency';
import { checkTraceSignal, isTraceAbort } from './trace-cancellation';
import {
  createTracePreparation,
  type DecodedTraceImage,
  type TracePreparation,
} from './trace-preparation';
import type { TracePreviewState } from './use-trace-preview';
import { readyTracePreview } from './use-trace-preview-settlement';
import { isTraceRequestSuperseded } from './use-trace-worker-client';
import type { TraceResult } from './use-trace-worker-client';
import { TracePreviewCache } from './trace-preview-cache';

export type DecodedSource = {
  readonly file: File;
  readonly controller: AbortController;
  readonly promise: Promise<DecodedTraceImage>;
  readonly cache: TracePreviewCache;
  readonly retryFailedDecode: () => void;
  decoded?: DecodedTraceImage;
};

type PreviewRefs = {
  readonly decoded: MutableRefObject<DecodedSource | null>;
  readonly preparation: MutableRefObject<TracePreparation | undefined>;
  readonly token: MutableRefObject<number>;
  readonly settled: MutableRefObject<number | null>;
  readonly setState: Dispatch<SetStateAction<TracePreviewState>>;
};

export function decodeTraceSource(file: File): DecodedSource {
  const controller = new AbortController();
  let failed = false;
  const source: DecodedSource = {
    file,
    controller,
    cache: new TracePreviewCache(file),
    get promise() {
      return promise;
    },
    retryFailedDecode: () => {
      if (!failed || controller.signal.aborted) return;
      failed = false;
      promise = decode();
    },
  };
  // Keep the same File owner so cleanup aborts every retry and valid cached
  // geometry survives a transient decoder failure. Pending/successful decodes
  // remain shared; only a later preview request can retry a rejected attempt.
  function decode(): Promise<DecodedTraceImage> {
    const attempt = loadImageAsRawData(file, PREVIEW_MAX_EDGE_PX, controller.signal).then(
      (img) => {
        checkTraceSignal(controller.signal);
        const decoded = { img, hasTransparency: rawImageHasTransparency(img) };
        source.decoded = decoded;
        return decoded;
      },
      (error: unknown) => {
        failed = true;
        throw error;
      },
    );
    void attempt.catch(() => undefined);
    return attempt;
  }
  let promise = decode();
  return source;
}

export function beginTracePreview(
  request: TracePreparationRequest | null,
  refs: PreviewRefs,
): (() => void) | undefined {
  const token = ++refs.token.current;
  const source = refs.decoded.current;
  if (request === null || source === null || source.file !== request.file) {
    refs.setState({ kind: 'idle' });
    return undefined;
  }
  const current = (): boolean => token === refs.token.current;
  const cached = source.cache.get(request);
  if (cached !== undefined) {
    refs.setState({
      ...cached,
      sourceHasTransparency: source.decoded?.hasTransparency ?? cached.sourceHasTransparency,
    });
    refs.preparation.current = undefined;
    return () => {
      refs.token.current += 1;
    };
  }
  source.retryFailedDecode();
  const startedAt = Date.now();
  refs.setState(
    source.decoded === undefined
      ? { kind: 'decoding', startedAt }
      : {
          kind: 'tracing',
          phase: 'preparing',
          startedAt,
          sourceHasTransparency: source.decoded.hasTransparency,
        },
  );
  const preparation = createTracePreparation(
    request,
    source.promise,
    source.decoded === undefined ? 0 : 300,
    (image, phase) => {
      if (current())
        refs.setState((previous) =>
          previous.kind === 'tracing' &&
          previous.phase === phase &&
          previous.startedAt === startedAt
            ? previous
            : { kind: 'tracing', phase, startedAt, sourceHasTransparency: image.hasTransparency },
        );
    },
  );
  refs.preparation.current = preparation;
  publishPreparation(preparation, source, refs, token);
  return () => {
    refs.token.current += 1;
    preparation.cancel();
    if (refs.preparation.current === preparation) refs.preparation.current = undefined;
  };
}

function publishPreparation(
  preparation: TracePreparation,
  source: DecodedSource,
  refs: PreviewRefs,
  token: number,
): void {
  const current = (): boolean => token === refs.token.current;
  void preparation.result.then(
    (result) => {
      if (!current()) return;
      const ready = readyPreparedPreview(
        source,
        preparation.request,
        result,
        source.decoded?.hasTransparency,
      );
      if (refs.settled.current !== token) refs.setState(ready);
    },
    (error: unknown) => {
      if (
        current() &&
        refs.settled.current !== token &&
        !isTraceAbort(error) &&
        !isTraceRequestSuperseded(error)
      ) {
        refs.setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
  // An external settlement may arrive while shared decoding is still pending.
  void source.promise.then(
    (image) => {
      if (current() && refs.settled.current === token)
        refs.setState((previous) =>
          previous.kind === 'ready'
            ? { ...previous, sourceHasTransparency: image.hasTransparency }
            : previous,
        );
    },
    () => undefined,
  );
}

export function readyPreparedPreview(
  source: DecodedSource | null,
  request: TracePreparationRequest,
  result: TraceResult,
  hasTransparency: boolean | undefined,
): Extract<TracePreviewState, { kind: 'ready' }> {
  const cached = source?.cache.get(request);
  if (cached?.preparedTrace?.result === result)
    return { ...cached, sourceHasTransparency: hasTransparency ?? cached.sourceHasTransparency };
  const ready = readyTracePreview(request, result, hasTransparency);
  source?.cache.remember(request, ready);
  return ready;
}
