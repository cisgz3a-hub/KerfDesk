/**
 * T1-17 pass 1: image preparation worker.
 *
 * Runs the `getImageData` + grayscale luminance loop off the main
 * thread so importing a phone-camera photo (4–12 MP) doesn't lock
 * the UI. The previous main-thread implementation in useImport.ts
 * spent tens to hundreds of ms inside `for (let i = 0; i < ...)`
 * during import — visible as dropped frames, jerky drag of the
 * just-imported image, and 1-2 s delays in panel updates.
 *
 * Protocol:
 *
 *   Main thread →
 *     postMessage({ id, bitmap, gsWidth, gsHeight }, [bitmap])
 *
 *   Worker →
 *     postMessage({ id, grayscaleData }, [grayscaleData.buffer])
 *
 * The ImageBitmap is transferable, so passing it doesn't copy
 * pixels. The output Uint8Array's underlying ArrayBuffer is also
 * transferred back so the receiver gets ownership without a copy.
 *
 * Fallback: if a runtime can't construct ImageBitmap or doesn't
 * have OffscreenCanvas (older Electron, test environments without
 * a DOM), the main-thread caller in `imagePrepClient.ts` runs the
 * legacy synchronous path. The math is identical — the worker just
 * does it on a different thread.
 */

// ───────────────────────────────────────────────────────────
// Pass 1 protocol: image grayscale preparation
// ───────────────────────────────────────────────────────────

interface ImagePrepRequest {
  kind: 'prep';
  id: number;
  bitmap: ImageBitmap;
  gsWidth: number;
  gsHeight: number;
}

interface ImagePrepResponse {
  kind: 'prep';
  id: number;
  grayscaleData: Uint8Array;
}

// ───────────────────────────────────────────────────────────
// Pass 4a protocol: brightness/contrast/gamma/invert/threshold
//
// Same five operations as `src/core/image/ImageProcessing.ts`,
// applied in the same canonical order. Math is byte-for-byte
// identical to the main-thread functions — pinned by
// `tests/image-processing-worker-equivalence.test.ts`.
// ───────────────────────────────────────────────────────────

interface ImageProcessRequest {
  kind: 'process';
  id: number;
  source: Uint8Array;     // grayscale bytes (length = width * height)
  width: number;
  height: number;
  brightness: number;     // -100..+100, 0 = no-op
  contrast: number;       // -100..+100, 0 = no-op
  gamma: number;          // 0.1..5, 1 = no-op
  invert: boolean;
  threshold: number | null; // null = skip threshold step
}

interface ImageProcessResponse {
  kind: 'process';
  id: number;
  data: Uint8Array;
}

type AnyRequest = ImagePrepRequest | ImageProcessRequest;
type AnyResponse = ImagePrepResponse | ImageProcessResponse;

// Backward-compat: pass-1 client still posts a request with no `kind`
// field. Treat any request without a `kind` as 'prep'.
function normalizeRequest(raw: AnyRequest | (Omit<ImagePrepRequest, 'kind'> & { kind?: undefined })): AnyRequest {
  if ((raw as AnyRequest).kind === undefined) {
    return { kind: 'prep', ...(raw as Omit<ImagePrepRequest, 'kind'>) };
  }
  return raw as AnyRequest;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function processImageInWorker(req: ImageProcessRequest): Uint8Array {
  const { source, brightness, contrast, gamma, invert, threshold } = req;
  let buf: Uint8Array = new Uint8Array(source);

  if (brightness !== 0) {
    const delta = brightness * 2.55;
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = clampByte(buf[i] + delta);
    buf = next;
  }
  if (contrast !== 0) {
    const factor = 1 + contrast / 100;
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = clampByte((buf[i] - 128) * factor + 128);
    buf = next;
  }
  if (gamma !== 1) {
    const g = Math.max(0.1, Math.min(5, gamma));
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
  if (invert) {
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = 255 - buf[i];
    buf = next;
  }
  if (threshold !== null) {
    const t = Math.max(0, Math.min(255, threshold));
    const next = new Uint8Array(buf.length);
    for (let i = 0; i < buf.length; i++) next[i] = buf[i] < t ? 255 : 0;
    buf = next;
  }
  return buf;
}

self.onmessage = (ev: MessageEvent<AnyRequest>) => {
  const req = normalizeRequest(ev.data);

  if (req.kind === 'process') {
    const data = processImageInWorker(req);
    const reply: ImageProcessResponse = { kind: 'process', id: req.id, data };
    (self as unknown as Worker).postMessage(reply, [data.buffer]);
    return;
  }

  // kind === 'prep'
  const { id, bitmap, gsWidth, gsHeight } = req;
  const canvas = new OffscreenCanvas(gsWidth, gsHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const empty = new Uint8Array(0);
    const reply: ImagePrepResponse = { kind: 'prep', id, grayscaleData: empty };
    (self as unknown as Worker).postMessage(reply, [empty.buffer]);
    return;
  }

  ctx.drawImage(bitmap, 0, 0, gsWidth, gsHeight);
  bitmap.close();
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

  const reply: ImagePrepResponse = { kind: 'prep', id, grayscaleData };
  (self as unknown as Worker).postMessage(reply, [grayscaleData.buffer]);
};

export type {
  ImagePrepRequest,
  ImagePrepResponse,
  ImageProcessRequest,
  ImageProcessResponse,
  AnyRequest,
  AnyResponse,
};

// Make this file a module (matches `type: 'module'` worker construction
// in imagePrepClient.ts).
export {};
