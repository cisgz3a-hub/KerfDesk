// Main-thread Convert-to-Bitmap worker client. Keeps heavy vector rasterization
// and PNG/luma encoding out of the UI thread when the browser supports workers.

import type { RasterImage } from '../../core/scene';
import type { BitmapConversionPlan } from './bitmap-conversion-plan';
import type { BitmapConversionOptions, ConvertibleVector } from './bitmap-assembly';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from './convert-bitmap-worker-protocol';

const CONVERT_BITMAP_WORKER_TIMEOUT_MS = 30_000;
export const MAX_INLINE_CONVERT_PIXELS = 500_000;

type Pending = {
  readonly resolve: (raster: RasterImage) => void;
  readonly reject: (err: Error) => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, Pending>();

export function canConvertBitmapInline(
  plan: Pick<BitmapConversionPlan, 'pixelWidth' | 'pixelHeight'>,
): boolean {
  return plan.pixelWidth * plan.pixelHeight <= MAX_INLINE_CONVERT_PIXELS;
}

export function convertBitmapInWorker(
  vector: ConvertibleVector,
  options: BitmapConversionOptions,
  rasterId: string,
): Promise<RasterImage> | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  return requestBitmap(worker, vector, options, rasterId);
}

export function resetConvertBitmapWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('Convert to Bitmap worker reset');
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    workerInstance = new Worker(new URL('./convert-bitmap-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = (): void => {
      rejectAllPendingAndRetireWorker('Convert to Bitmap worker errored');
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<ConvertBitmapWorkerResponse>): void {
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined) return;
  pendingByRequestId.delete(e.data.id);
  if (e.data.kind === 'ok') {
    pending.resolve(e.data.raster);
    return;
  }
  pending.reject(new Error(e.data.message));
}

function requestBitmap(
  worker: Worker,
  vector: ConvertibleVector,
  options: BitmapConversionOptions,
  rasterId: string,
): Promise<RasterImage> {
  return new Promise<RasterImage>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    const timer = setTimeout(() => {
      if (!pendingByRequestId.has(id)) return;
      rejectAllPendingAndRetireWorker('Convert to Bitmap worker timed out');
    }, CONVERT_BITMAP_WORKER_TIMEOUT_MS);
    pendingByRequestId.set(id, {
      resolve: (raster) => {
        clearTimeout(timer);
        resolve(raster);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    const request: ConvertBitmapWorkerRequest = { id, rasterId, vector, options };
    try {
      worker.postMessage(request);
    } catch (err) {
      pendingByRequestId.delete(id);
      clearTimeout(timer);
      retireWorker();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function rejectAllPendingAndRetireWorker(message: string): void {
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  retireWorker();
  for (const pending of pendings) {
    pending.reject(new Error(message));
  }
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.terminate();
  workerInstance = null;
}
