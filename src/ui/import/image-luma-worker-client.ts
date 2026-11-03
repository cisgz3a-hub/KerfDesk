import { decodeImageOntoCanvas } from '../trace/image-loader';
import { traceSourceHasMask } from '../trace/trace-source-mask';
import { checkTraceSignal, traceAbortError } from '../trace/trace-cancellation';
import type { ImageLumaRequest, ImageLumaResponse } from './image-luma-decode';

/** After this long the import shows its progress notice with Esc to cancel. */
export const SLOW_IMAGE_DECODE_NOTICE_MS = 300;

export type OffThreadImageLuma = {
  readonly sampled: { readonly width: number; readonly height: number };
  readonly lumaBase64: string;
};

export type OffThreadImageLumaOptions = {
  readonly signal?: AbortSignal;
  /** Called once if the decode is still running after SLOW_IMAGE_DECODE_NOTICE_MS. */
  readonly onSlow?: () => void;
};

/**
 * Decode and draw a photo with the loader's own canvas code, then read it back
 * and take its luma in a short-lived worker, so a phone photo no longer holds
 * the UI thread for a second (S3-P2-1). The worker reads a snapshot of that
 * canvas, so the luma bytes are the loader's. Resolves null when no worker
 * route exists (no Worker, OffscreenCanvas or createImageBitmap, a masked
 * trace source) or the worker failed: the caller then runs the UI-thread
 * loader. A real decode error rejects as the loader's does; so does Cancel.
 */
export async function decodeBurnLumaOffThread(
  file: File,
  maxEdge: number,
  options: OffThreadImageLumaOptions = {},
): Promise<OffThreadImageLuma | null> {
  const { signal } = options;
  if (!offThreadImageDecodeAvailable() || traceSourceHasMask(file)) return null;
  const slow = setTimeout(() => options.onSlow?.(), SLOW_IMAGE_DECODE_NOTICE_MS);
  try {
    const bitmap = await decodeImageOntoCanvas(file, maxEdge, snapshotCanvas, signal);
    if (signal?.aborted === true) {
      bitmap.close();
      checkTraceSignal(signal);
    }
    return await lumaInWorker(bitmap, signal);
  } finally {
    clearTimeout(slow);
  }
}

async function snapshotCanvas(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(canvas);
  } finally {
    // Release the canvas's backing store; the snapshot holds the pixels.
    canvas.width = 0;
    canvas.height = 0;
  }
}

function lumaInWorker(
  bitmap: ImageBitmap,
  signal: AbortSignal | undefined,
): Promise<OffThreadImageLuma | null> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./image-luma-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    bitmap.close();
    return Promise.resolve(null);
  }
  return new Promise<OffThreadImageLuma | null>((resolve, reject) => {
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
    worker.onmessage = (event: MessageEvent<ImageLumaResponse>) =>
      finish(() => resolve(offThreadResult(event.data)));
    worker.onerror = () => finish(() => resolve(null));
    worker.onmessageerror = () => finish(() => resolve(null));
    try {
      const request: ImageLumaRequest = { bitmap };
      worker.postMessage(request, [bitmap]);
    } catch {
      bitmap.close();
      finish(() => resolve(null));
    }
  });
}

function offThreadResult(response: ImageLumaResponse): OffThreadImageLuma | null {
  if (response.kind !== 'ok') return null;
  return {
    sampled: { width: response.width, height: response.height },
    lumaBase64: response.lumaBase64,
  };
}

function offThreadImageDecodeAvailable(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}
