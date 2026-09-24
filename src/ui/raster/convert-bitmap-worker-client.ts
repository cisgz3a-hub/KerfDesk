// One conversion owns one worker. Supersession, cancellation and every failure
// retire that exact request, so obsolete work cannot consume resources or kill
// a newer worker. Successful settlement also releases the worker's peak buffers.

import type { RasterImage } from '../../core/scene';
import type { BitmapConversionOptions, ConvertibleVector } from './bitmap-assembly';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from './convert-bitmap-worker-protocol';

const CONVERT_BITMAP_WORKER_TIMEOUT_MS = 30_000;

type Pending = {
  readonly id: number;
  readonly worker: Worker;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly resolve: (raster: RasterImage) => void;
  readonly reject: (err: Error) => void;
};

let nextRequestId = 0;
let activeRequest: Pending | null = null;

export function convertBitmapInWorker(
  vectors: ReadonlyArray<ConvertibleVector>,
  options: BitmapConversionOptions,
  rasterId: string,
  signal?: AbortSignal,
): Promise<RasterImage> | null {
  if (signal?.aborted === true) return Promise.reject(abortError());
  if (activeRequest !== null) rejectRequest(activeRequest, abortError());
  const worker = createWorker();
  if (worker === null) return null;
  return requestBitmap(worker, vectors, options, rasterId, signal);
}

export function resetConvertBitmapWorkerForTests(): void {
  if (activeRequest !== null) rejectRequest(activeRequest, abortError());
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./convert-bitmap-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

function requestBitmap(
  worker: Worker,
  vectors: ReadonlyArray<ConvertibleVector>,
  options: BitmapConversionOptions,
  rasterId: string,
  signal: AbortSignal | undefined,
): Promise<RasterImage> {
  return new Promise<RasterImage>((resolve, reject) => {
    const id = ++nextRequestId;
    const onAbort = (): void => rejectRequest(request, abortError());
    const timer = setTimeout(() => {
      rejectRequest(request, new Error('Convert to Bitmap worker timed out'));
    }, CONVERT_BITMAP_WORKER_TIMEOUT_MS);
    const request: Pending = { id, worker, timer, signal, onAbort, resolve, reject };
    activeRequest = request;
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ConvertBitmapWorkerResponse>): void => {
      if (event.data.id !== id) return;
      if (event.data.kind === 'ok') {
        if (retireRequest(request)) resolve(event.data.raster);
      } else {
        rejectRequest(request, new Error(event.data.message));
      }
    };
    worker.onerror = (): void => {
      rejectRequest(request, new Error('Convert to Bitmap worker errored'));
    };
    worker.onmessageerror = (): void => {
      rejectRequest(request, new Error('Could not read the Convert to Bitmap worker result'));
    };
    const message: ConvertBitmapWorkerRequest = { id, rasterId, vectors, options };
    try {
      const photo = options.photoRibbons;
      if (photo === undefined) worker.postMessage(message);
      else worker.postMessage(message, [photo.points.buffer, photo.offsets.buffer]);
    } catch (err) {
      rejectRequest(request, err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function rejectRequest(request: Pending, error: Error): void {
  if (retireRequest(request)) request.reject(error);
}

function retireRequest(request: Pending): boolean {
  if (activeRequest !== request) return false;
  activeRequest = null;
  clearTimeout(request.timer);
  request.signal?.removeEventListener('abort', request.onAbort);
  request.worker.onmessage = null;
  request.worker.onerror = null;
  request.worker.onmessageerror = null;
  request.worker.terminate();
  return true;
}

function abortError(): Error {
  return new DOMException('Bitmap conversion cancelled', 'AbortError');
}
