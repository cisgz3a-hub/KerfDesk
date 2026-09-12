/// <reference lib="webworker" />

import type { PreparedPreviewFrame } from './preview-route-frame';
import { unpackPreviewFrame } from './preview-route-frame-transfer';
import { renderPreviewFrame } from './preview-route-render';
import type {
  PreviewRouteWorkerRequest,
  PreviewRouteWorkerResponse,
} from './preview-route-worker-protocol';

let currentFrame: { readonly id: number; readonly frame: PreparedPreviewFrame } | null = null;
let canvas: OffscreenCanvas | null = null;
let interactiveCanvas: OffscreenCanvas | null = null;

function renderCanvas(request: PreviewRouteWorkerRequest): OffscreenCanvas {
  if (request.interactive === true) {
    interactiveCanvas ??= new OffscreenCanvas(request.width, request.height);
    return interactiveCanvas;
  }
  canvas ??= new OffscreenCanvas(request.width, request.height);
  return canvas;
}

// The client permits one request in flight and retains only its newest desired
// replacement. The worker therefore never owns a queue of route snapshots.
self.onmessage = (event: MessageEvent<PreviewRouteWorkerRequest>): void => {
  const request = event.data;
  let bitmap: ImageBitmap | null = null;
  try {
    if (request.frame !== undefined) {
      currentFrame = { id: request.frameId, frame: unpackPreviewFrame(request.frame) };
    }
    if (currentFrame === null || currentFrame.id !== request.frameId) {
      throw new Error('Preview route frame is unavailable');
    }
    const targetCanvas = renderCanvas(request);
    if (targetCanvas.width !== request.width) targetCanvas.width = request.width;
    if (targetCanvas.height !== request.height) targetCanvas.height = request.height;
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: request.interactive === true });
    if (ctx === null) throw new Error('Preview route canvas is unavailable');
    ctx.clearRect(0, 0, request.width, request.height);
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(request.background, 0, 0);
    } finally {
      ctx.restore();
    }
    renderPreviewFrame(ctx, currentFrame.frame, request.view);
    bitmap = targetCanvas.transferToImageBitmap();
    const response: PreviewRouteWorkerResponse = {
      kind: 'painted',
      id: request.id,
      frameId: request.frameId,
      bitmap,
    };
    self.postMessage(response, [bitmap]);
  } catch (error) {
    bitmap?.close();
    const response: PreviewRouteWorkerResponse = {
      kind: 'error',
      id: request.id,
      frameId: request.frameId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  } finally {
    request.background.close();
  }
};
