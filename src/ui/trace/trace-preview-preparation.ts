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

export type DecodedSource = {
  readonly file: File;
  readonly controller: AbortController;
  readonly promise: Promise<DecodedTraceImage>;
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
  const source: DecodedSource = {
    file,
    controller,
    promise: loadImageAsRawData(file, PREVIEW_MAX_EDGE_PX, controller.signal).then((img) => {
      checkTraceSignal(controller.signal);
      const decoded = { img, hasTransparency: rawImageHasTransparency(img) };
      source.decoded = decoded;
      return decoded;
    }),
  };
  void source.promise.catch(() => undefined);
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
  refs.setState(
    source.decoded === undefined
      ? { kind: 'decoding' }
      : { kind: 'tracing', sourceHasTransparency: source.decoded.hasTransparency },
  );
  const preparation = createTracePreparation(
    request,
    source.promise,
    source.decoded === undefined ? 0 : 300,
    (image) => {
      if (current())
        refs.setState({ kind: 'tracing', sourceHasTransparency: image.hasTransparency });
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
      if (current() && refs.settled.current !== token) {
        refs.setState(
          readyTracePreview(preparation.request, result, source.decoded?.hasTransparency),
        );
      }
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
