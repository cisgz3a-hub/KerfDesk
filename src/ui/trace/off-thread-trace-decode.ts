// The trace dialog's source decode, with its readback off the UI thread (perf
// audit S5-P3-3): a 12 MP photo or a 4096 page blocked the window 300-500 ms
// when Trace was pressed, and about 220-260 ms when the dialog opened, while
// getImageData and the composite over white ran here. The decode and drawing
// stay the loader's own (decodeImageOntoCanvas); a snapshot of its canvas is
// read back in a short-lived worker, as the photo import does since S3-P2-1,
// so the pixels are the ones the loader returns. A masked source, a browser
// without the worker route, or a worker that fails decodes here as before.

import type { RawImageData } from '../../core/trace';
import { offThreadImageDecodeAvailable, snapshotCanvas } from '../import/image-luma-worker-client';
import type { CompositedPixelsResponse } from './composited-pixels';
import { decodeImageOntoCanvas, loadImageAsRawData } from './image-loader';
import { rawImageHasTransparency } from './raw-image-transparency';
import { checkTraceSignal, traceAbortError } from './trace-cancellation';
import { PREVIEW_MAX_EDGE_PX } from './trace-decode-cap';
import { traceSourceHasMask } from './trace-source-mask';

export type DecodedTraceSource = {
  readonly image: RawImageData;
  readonly hasTransparency: boolean;
};

export async function decodeTraceSourceImage(
  file: File,
  maxEdge: number | undefined,
  signal?: AbortSignal,
): Promise<DecodedTraceSource> {
  const offThread = await decodeOffThread(file, maxEdge, signal);
  if (offThread !== null) return offThread;
  const image = await loadImageAsRawData(file, maxEdge, signal);
  return { image, hasTransparency: rawImageHasTransparency(image) };
}

async function decodeOffThread(
  file: File,
  maxEdge: number | undefined,
  signal: AbortSignal | undefined,
): Promise<DecodedTraceSource | null> {
  if (!offThreadImageDecodeAvailable() || traceSourceHasMask(file)) return null;
  // The loader's own default edge applies when the caller leaves it out.
  const edge = maxEdge ?? PREVIEW_MAX_EDGE_PX;
  const bitmap = await decodeImageOntoCanvas(file, edge, snapshotCanvas, signal);
  if (signal?.aborted === true) {
    bitmap.close();
    checkTraceSignal(signal);
  }
  return readBackInWorker(bitmap, signal);
}

function readBackInWorker(
  bitmap: ImageBitmap,
  signal: AbortSignal | undefined,
): Promise<DecodedTraceSource | null> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./composited-pixels-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    bitmap.close();
    return Promise.resolve(null);
  }
  return new Promise<DecodedTraceSource | null>((resolve, reject) => {
    const finish = (settle: () => void): void => {
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      settle();
    };
    const abort = (): void => finish(() => reject(traceAbortError()));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<CompositedPixelsResponse>) =>
      finish(() =>
        resolve(
          event.data.kind === 'ok'
            ? { image: event.data.image, hasTransparency: event.data.hasTransparency }
            : null,
        ),
      );
    worker.onerror = () => finish(() => resolve(null));
    worker.onmessageerror = () => finish(() => resolve(null));
    try {
      worker.postMessage({ bitmap }, [bitmap]);
    } catch {
      bitmap.close();
      finish(() => resolve(null));
    }
  });
}
