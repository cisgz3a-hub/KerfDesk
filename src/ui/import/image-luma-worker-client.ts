import { readBurnDecodePlan } from '../trace/image-loader';
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
 * Decode, sample and take the luma of a photo in a short-lived worker, so a
 * phone photo no longer holds the UI thread for a second (S3-P2-1). Resolves
 * null whenever the worker cannot give the UI-thread loader's exact bytes
 * (no worker, a masked trace source, an engine that needs the canvas to scale
 * or turn the image, a decode error): the caller then runs that loader, which
 * also reports any real decode failure. Rejects only on cancellation.
 */
export async function decodeBurnLumaOffThread(
  file: File,
  maxEdge: number,
  options: OffThreadImageLumaOptions = {},
): Promise<OffThreadImageLuma | null> {
  const { signal } = options;
  if (!offThreadImageDecodeAvailable() || traceSourceHasMask(file)) return null;
  const plan = await readBurnDecodePlan(file, maxEdge, signal);
  checkTraceSignal(signal);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./image-luma-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  const request: ImageLumaRequest = {
    file,
    target: plan?.target ?? null,
    resize: plan?.resize ?? false,
    maxEdge,
  };
  return new Promise<OffThreadImageLuma | null>((resolve, reject) => {
    const slow = setTimeout(() => options.onSlow?.(), SLOW_IMAGE_DECODE_NOTICE_MS);
    const finish = (settle: () => void): void => {
      clearTimeout(slow);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      settle();
    };
    const abort = (): void => finish(() => reject(traceAbortError()));
    if (signal?.aborted === true) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ImageLumaResponse>) =>
      finish(() => resolve(offThreadResult(event.data)));
    worker.onerror = () => finish(() => resolve(null));
    worker.onmessageerror = () => finish(() => resolve(null));
    try {
      worker.postMessage(request);
    } catch {
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
