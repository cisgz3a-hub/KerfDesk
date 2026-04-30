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

interface ImagePrepRequest {
  id: number;
  bitmap: ImageBitmap;
  gsWidth: number;
  gsHeight: number;
}

interface ImagePrepResponse {
  id: number;
  grayscaleData: Uint8Array;
}

self.onmessage = (ev: MessageEvent<ImagePrepRequest>) => {
  const { id, bitmap, gsWidth, gsHeight } = ev.data;

  const canvas = new OffscreenCanvas(gsWidth, gsHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // OffscreenCanvas exists but 2D context unavailable. Bounce back
    // an empty result; client reverts to fallback path on next call.
    const empty = new Uint8Array(0);
    const reply: ImagePrepResponse = { id, grayscaleData: empty };
    (self as unknown as Worker).postMessage(reply, [empty.buffer]);
    return;
  }

  ctx.drawImage(bitmap, 0, 0, gsWidth, gsHeight);
  bitmap.close(); // release pixel memory promptly
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

  const reply: ImagePrepResponse = { id, grayscaleData };
  (self as unknown as Worker).postMessage(reply, [grayscaleData.buffer]);
};

// Make this file a module (matches `type: 'module'` worker construction
// in imagePrepClient.ts).
export {};
