// Web Worker that runs the trace pipeline off the main thread.
// Receives a RawImageData + TraceOptions, returns ColoredPath[].
// Step 5 of the LF1 image-trace port — preserves UI responsiveness
// during the 50-500ms preprocess+trace window on larger inputs.
//
// The work itself is identical to traceImageToColoredPaths in
// trace-to-paths.ts (we share the pure-core preprocessing helpers and
// the tracedata-to-ColoredPath converter). The wrinkle is that the
// worker has its own module-load + tracer-cache lifecycle, separate
// from the main thread's, so a heavy import only happens once per
// worker instance (the live preview reuses the same worker across
// preset changes).
//
// Vite loads this via the `?worker` import suffix at the call site —
// see use-trace-worker-client.ts. The worker is bundled separately
// and not part of the main entry chunk.

/// <reference lib="webworker" />

import type { Bounds, ColoredPath } from '../../core/scene';
import {
  type RawImageData,
  type TraceOptions,
  boundsFromColoredPaths,
  traceImageToColoredPaths,
} from '../../core/trace';

export type TraceWorkerRequest = {
  readonly id: number;
  readonly image: RawImageData;
  readonly options: TraceOptions;
};

export type TraceWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'ok';
      readonly paths: ColoredPath[];
      readonly bounds: Bounds;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

self.onmessage = (e: MessageEvent<TraceWorkerRequest>): void => {
  const { id, image, options } = e.data;
  void (async (): Promise<void> => {
    try {
      const paths = await traceImageToColoredPaths(image, options);
      const bounds = boundsFromColoredPaths(paths);
      const response: TraceWorkerResponse = { id, kind: 'ok', paths, bounds };
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
