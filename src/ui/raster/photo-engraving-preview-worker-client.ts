import { photoEngravingPreviewInputError } from './photo-engraving-preview-budget';
import {
  photoPreviewMaxEdge,
  type PhotoEngravingPreviewInput,
  type PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';
import type {
  PhotoEngravingPreviewWorkerRequest,
  PhotoEngravingPreviewWorkerResponse,
} from './photo-engraving-preview-worker-protocol';

const PREVIEW_WORKER_TIMEOUT_MS = 30_000;

type Pending = {
  readonly id: number;
  readonly worker: Worker;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly resolve: (result: PhotoEngravingPreviewResult) => void;
  readonly reject: (cause: Error) => void;
};

let nextRequestId = 0;
let activeRequest: Pending | null = null;

/** Each edit owns a worker; cancellation actually stops synchronous compile. */
export function previewPhotoEngravingInWorker(
  input: PhotoEngravingPreviewInput,
  signal?: AbortSignal,
  requestedMaxEdge?: number,
): Promise<PhotoEngravingPreviewResult> {
  if (signal?.aborted === true) return Promise.reject(abortError());
  if (activeRequest !== null) abortRequest(activeRequest);
  const maxEdge = photoPreviewMaxEdge(requestedMaxEdge);
  const error = photoEngravingPreviewInputError(input, maxEdge);
  if (error !== null) return Promise.resolve({ kind: 'error', message: error });
  const worker = createWorker();
  if (worker === null) {
    return Promise.resolve({
      kind: 'error',
      message: 'Background photo preview is unavailable in this browser.',
    });
  }
  return requestPreview(worker, compactInput(input), maxEdge, signal);
}

export function resetPhotoEngravingPreviewWorkerForTests(): void {
  if (activeRequest !== null) abortRequest(activeRequest);
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./photo-engraving-preview-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

function compactInput(input: PhotoEngravingPreviewInput): PhotoEngravingPreviewInput {
  // Compile reads luma, never the PNG/JPEG display source. Only the selected
  // image's external mask can be consulted in the rest of the scene.
  const { dataUrl: _dataUrl, ...image } = input.image;
  const sceneObjects = input.sceneObjects.filter((object) => object.id === image.imageMaskId);
  return { ...input, image, sceneObjects };
}

function requestPreview(
  worker: Worker,
  input: PhotoEngravingPreviewInput,
  maxEdge: number,
  signal: AbortSignal | undefined,
): Promise<PhotoEngravingPreviewResult> {
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId;
    const onAbort = (): void => abortRequest(request);
    const timer = setTimeout(
      () => settleError(request, 'Photo preview timed out.'),
      PREVIEW_WORKER_TIMEOUT_MS,
    );
    const request: Pending = { id, worker, timer, signal, onAbort, resolve, reject };
    activeRequest = request;
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<PhotoEngravingPreviewWorkerResponse>): void => {
      if (event.data.id === id && retireRequest(request)) resolve(event.data.result);
    };
    worker.onerror = (): void => settleError(request, 'The background photo preview failed.');
    worker.onmessageerror = (): void =>
      settleError(request, 'The photo preview result could not be read.');
    const message: PhotoEngravingPreviewWorkerRequest = { id, input, maxEdge };
    try {
      worker.postMessage(message);
    } catch (cause) {
      settleError(request, cause instanceof Error ? cause.message : String(cause));
    }
  });
}

function settleError(request: Pending, message: string): void {
  if (retireRequest(request)) request.resolve({ kind: 'error', message });
}

function abortRequest(request: Pending): void {
  if (retireRequest(request)) request.reject(abortError());
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
  return new DOMException('Photo preview cancelled', 'AbortError');
}
