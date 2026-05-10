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

import { ditherImage, type DitherMode as DitherModeName } from '../import/Dithering';

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
        const onMessage = (ev: MessageEvent<{ kind?: 'prep' | 'process'; id: number; grayscaleData?: Uint8Array; data?: Uint8Array }>) => {
          if (ev.data.id !== id) return;
          // Ignore process responses arriving on this listener (different id space anyway).
          if (ev.data.kind === 'process') return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          const grayscaleData = ev.data.grayscaleData ?? new Uint8Array(0);
          if (grayscaleData.length === 0) {
            // Worker bounce — OffscreenCanvas 2D context unavailable.
            // Fall through to main-thread path on retry.
            workerKnownBroken = true;
            resolve(prepareImageGrayscaleMainThread(img, gsWidth, gsHeight));
            return;
          }
          resolve(grayscaleData);
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

// ───────────────────────────────────────────────────────────
// T1-17 Pass 4a: image processing pipeline (off-thread when possible)
// ───────────────────────────────────────────────────────────

/**
 * Settings driving the image-processing pipeline. All five fields are
 * required so a callsite can't accidentally drop one and silently get
 * different output. Pass `threshold = null` to skip the threshold step.
 */
export interface ImageProcessSettings {
  brightness: number;       // -100..+100, 0 = no-op
  contrast: number;         // -100..+100, 0 = no-op
  gamma: number;            // 0.1..5, 1 = no-op
  invert: boolean;
  threshold: number | null; // null = skip threshold step
}

let imageProcessRequestId = 0;

/**
 * Apply brightness → contrast → gamma → invert → (optional) threshold
 * in the same canonical order as `src/core/image/ImageProcessing.ts`,
 * off the main thread when the worker is available, on the main thread
 * as a transparent fallback.
 *
 * Output is byte-for-byte identical between worker and fallback paths.
 * Pinned by `tests/image-processing-worker-equivalence.test.ts`.
 *
 * Note: this function does NOT yet wire into JobCompiler or
 * PropertiesPanel. Pass 4a ships the primitive only. Pass 4b wires
 * JobCompiler; Pass 4c wires the UI.
 */
export async function processImage(
  source: Uint8Array,
  width: number,
  height: number,
  settings: ImageProcessSettings,
): Promise<Uint8Array> {
  const worker = getImagePrepWorker();

  if (worker) {
    try {
      const id = ++imageProcessRequestId;
      return await new Promise<Uint8Array>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<{ kind?: 'prep' | 'process'; id: number; data?: Uint8Array }>) => {
          if (ev.data.id !== id) return;
          if (ev.data.kind !== 'process') return; // ignore prep-channel replies
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (!ev.data.data) {
            workerKnownBroken = true;
            resolve(processImageMainThread(source, width, height, settings));
            return;
          }
          resolve(ev.data.data);
        };
        const onError = (ev: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(new Error(`Image process worker error: ${ev.message}`));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        // Copy `source` into a transferable buffer; we don't want to
        // steal the caller's buffer.
        const sourceCopy = new Uint8Array(source);
        worker.postMessage({
          kind: 'process',
          id,
          source: sourceCopy,
          width,
          height,
          brightness: settings.brightness,
          contrast: settings.contrast,
          gamma: settings.gamma,
          invert: settings.invert,
          threshold: settings.threshold,
        }, [sourceCopy.buffer]);
      });
    } catch (err) {
      console.warn('[ImagePrepWorker] process dispatch failed, falling back to main thread:', err);
      workerKnownBroken = true;
      // fall through to main-thread path
    }
  }

  return processImageMainThread(source, width, height, settings);
}

// ───────────────────────────────────────────────────────────
// T1-17-followup: dither off the main thread
// ───────────────────────────────────────────────────────────

let imageDitherRequestId = 0;

/**
 * T1-17-followup: off-load `ditherImage` to the existing image-prep
 * worker. Pre-T1-17-followup, `PropertiesPanel.tsx`'s dither-mode
 * onChange called `ditherImage(...)` synchronously on the main
 * thread; for a 12 MP image (~12 M pixels) every error-diffusion pass
 * is hundreds of ms to seconds, freezing the canvas. A 2026-05-12
 * Falcon hardware test surfaced this as a 5+ second canvas freeze
 * when changing dither mode after photo import.
 *
 * Output is byte-for-byte identical to a synchronous `ditherImage`
 * call (the worker imports the same pure function from
 * `src/import/Dithering.ts`). The worker fall-back path runs the
 * same function on the main thread when no worker is available
 * (older Electron, jsdom, locked-down browsers).
 */
export async function ditherInWorker(
  source: Uint8Array,
  width: number,
  height: number,
  mode: DitherModeName,
  threshold: number,
): Promise<Uint8Array> {
  const worker = getImagePrepWorker();

  if (worker) {
    try {
      const id = ++imageDitherRequestId;
      return await new Promise<Uint8Array>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<{ kind?: 'prep' | 'process' | 'dither'; id: number; data?: Uint8Array }>) => {
          if (ev.data.id !== id) return;
          if (ev.data.kind !== 'dither') return; // ignore other channels
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (!ev.data.data) {
            workerKnownBroken = true;
            resolve(ditherImage(source, width, height, mode, threshold));
            return;
          }
          resolve(ev.data.data);
        };
        const onError = (ev: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(new Error(`Image dither worker error: ${ev.message}`));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        const sourceCopy = new Uint8Array(source);
        worker.postMessage({
          kind: 'dither',
          id,
          source: sourceCopy,
          width,
          height,
          mode,
          threshold,
        }, [sourceCopy.buffer]);
      });
    } catch (err) {
      console.warn('[ImagePrepWorker] dither dispatch failed, falling back to main thread:', err);
      workerKnownBroken = true;
    }
  }

  return ditherImage(source, width, height, mode, threshold);
}

/**
 * Synchronous fallback. Same five operations in the same order as the
 * worker. Same byte-for-byte output as the existing
 * `src/core/image/ImageProcessing.ts` functions (verified by the
 * equivalence test).
 *
 * Exported so Fix #4 (Pass 4b)'s JobCompiler integration can call it
 * directly when a synchronous answer is needed (e.g. from inside a
 * test that doesn't have an event loop, or from a callsite where the
 * caller has already committed to staying on the main thread).
 */
export function processImageMainThread(
  source: Uint8Array,
  _width: number,
  _height: number,
  settings: ImageProcessSettings,
): Uint8Array {
  const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  let buf: Uint8Array = new Uint8Array(source);

  if (settings.brightness !== 0) {
    const delta = settings.brightness * 2.55;
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = clampByte(buf[i] + delta);
    buf = next;
  }
  if (settings.contrast !== 0) {
    const factor = 1 + settings.contrast / 100;
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = clampByte((buf[i] - 128) * factor + 128);
    buf = next;
  }
  if (settings.gamma !== 1) {
    const g = Math.max(0.1, Math.min(5, settings.gamma));
    if (g !== 1) {
      const invG = 1 / g;
      const next = new Uint8Array(buf.length);
      for (let i = 0; i < buf.length; i++) {
        const nv = Math.pow(Math.max(0, Math.min(1, buf[i] / 255)), invG);
        next[i] = clampByte(nv * 255);
      }
      buf = next;
    }
  }
  if (settings.invert) {
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = 255 - buf[i];
    buf = next;
  }
  if (settings.threshold !== null) {
    const t = Math.max(0, Math.min(255, settings.threshold));
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = buf[i] < t ? 255 : 0;
    buf = next;
  }
  return buf;
}
