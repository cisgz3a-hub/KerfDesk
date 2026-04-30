/**
 * T1-17 pass 1: client wrapper for the image prep worker.
 *
 * The hot path is `prepareImageGrayscale(img, gsWidth, gsHeight)`,
 * called once per image import from `useImport.ts`. It tries to
 * offload the canvas + grayscale work to a Web Worker; if any of
 * `Worker`, `OffscreenCanvas`, or `createImageBitmap` are missing
 * (older Electron, jsdom test envs, locked-down browsers), it
 * falls back to the legacy main-thread path.
 *
 * The fallback math is byte-for-byte identical to the worker's
 * loop. There's a regression test that pins this — see
 * tests/image-prep-grayscale-equivalence.test.ts.
 *
 * The worker is instantiated lazily on first call and reused across
 * imports. Same singleton pattern as PotraceTracer.ts:getTraceWorker.
 *
 * If the worker errors at any point during a request (broken bitmap
 * transfer, OOM, OffscreenCanvas unsupported in this build) the
 * client logs once and retries the request on the main thread. The
 * caller never sees the worker failure.
 */

let imagePrepWorkerInstance: Worker | null = null;
let imagePrepRequestId = 0;
let workerKnownBroken = false;

function getImagePrepWorker(): Worker | null {
  if (workerKnownBroken) return null;
  if (typeof Worker === 'undefined') return null;
  if (typeof OffscreenCanvas === 'undefined') return null;
  if (typeof createImageBitmap === 'undefined') return null;

  if (!imagePrepWorkerInstance) {
    try {
      imagePrepWorkerInstance = new Worker(
        new URL('./ImagePrepWorker.ts', import.meta.url),
        { type: 'module' },
      );
      imagePrepWorkerInstance.addEventListener('error', (ev) => {
        console.warn('[ImagePrepWorker] error, falling back to main thread:', ev.message);
        workerKnownBroken = true;
        imagePrepWorkerInstance?.terminate();
        imagePrepWorkerInstance = null;
      });
    } catch (err) {
      console.warn('[ImagePrepWorker] construction failed, using main thread:', err);
      workerKnownBroken = true;
      return null;
    }
  }
  return imagePrepWorkerInstance;
}

/**
 * Convert an HTMLImageElement to its grayscale luminance buffer at
 * the requested dimensions. Off-thread when possible, on-thread as
 * a transparent fallback.
 *
 * The math:
 *   lum = 0.299*R + 0.587*G + 0.114*B  (Rec. 601 luminance)
 *   gs[i] = round(lum * (a/255) + 255 * (1 - a/255))
 *           // alpha-composited over white background
 *
 * Output is the same regardless of execution path (worker or
 * main thread) — verified by the equivalence test.
 */
export async function prepareImageGrayscale(
  img: HTMLImageElement,
  gsWidth: number,
  gsHeight: number,
): Promise<Uint8Array> {
  const worker = getImagePrepWorker();

  if (worker) {
    try {
      const bitmap = await createImageBitmap(img);
      const id = ++imagePrepRequestId;
      return await new Promise<Uint8Array>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<{ id: number; grayscaleData: Uint8Array }>) => {
          if (ev.data.id !== id) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (ev.data.grayscaleData.length === 0) {
            // Worker bounce — OffscreenCanvas 2D context unavailable.
            // Fall through to main-thread path on retry.
            workerKnownBroken = true;
            resolve(prepareImageGrayscaleMainThread(img, gsWidth, gsHeight));
            return;
          }
          resolve(ev.data.grayscaleData);
        };
        const onError = (ev: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(new Error(`Image prep worker error: ${ev.message}`));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ id, bitmap, gsWidth, gsHeight }, [bitmap]);
      });
    } catch (err) {
      console.warn('[ImagePrepWorker] dispatch failed, falling back to main thread:', err);
      workerKnownBroken = true;
      // fall through to main-thread path
    }
  }

  return prepareImageGrayscaleMainThread(img, gsWidth, gsHeight);
}

/**
 * Synchronous fallback. Same math as the worker, runs on the main
 * thread. Used when no worker is available, or after a worker
 * dispatch has failed.
 *
 * Exported for the equivalence test, which compares the worker
 * output to this function's output for a known input.
 */
export function prepareImageGrayscaleMainThread(
  img: HTMLImageElement | { width: number; height: number } | ImageBitmap,
  gsWidth: number,
  gsHeight: number,
): Uint8Array {
  const offscreen = document.createElement('canvas');
  offscreen.width = gsWidth;
  offscreen.height = gsHeight;
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    // No 2D context at all (extremely unusual). Return zeros so the
    // caller still gets a valid SceneObject — it just renders blank
    // until the user re-imports under a working environment.
    return new Uint8Array(gsWidth * gsHeight);
  }
  // Cast: drawImage accepts HTMLImageElement, ImageBitmap, etc.
  ctx.drawImage(img as CanvasImageSource, 0, 0, gsWidth, gsHeight);
  const imageData = ctx.getImageData(0, 0, gsWidth, gsHeight);
  const data = imageData.data;
  const grayscaleData = new Uint8Array(gsWidth * gsHeight);
  for (let i = 0; i < grayscaleData.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    grayscaleData[i] = Math.round(lum * (a / 255) + 255 * (1 - a / 255));
  }
  return grayscaleData;
}

/**
 * Pure grayscale-from-RGBA function for tests. Same math as both
 * the worker loop and the main-thread fallback. Lets us verify
 * equivalence without needing a DOM or OffscreenCanvas.
 *
 * `rgba` is a Uint8ClampedArray of [r, g, b, a, r, g, b, a, ...]
 * with length `width * height * 4`. Output is `width * height`
 * grayscale bytes.
 */
export function rgbaToGrayscale(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = Math.round(lum * (a / 255) + 255 * (1 - a / 255));
  }
  return out;
}
