/// <reference lib="webworker" />

import { compositedPixelsFromDrawnImage, type CompositedPixelsResponse } from './composited-pixels';

self.onmessage = (event: MessageEvent<{ readonly bitmap: ImageBitmap }>): void => {
  const response: CompositedPixelsResponse = compositedPixelsFromDrawnImage(
    event.data.bitmap,
    (width, height) =>
      new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }),
  );
  self.postMessage(response, response.kind === 'ok' ? [response.image.data.buffer] : []);
};
