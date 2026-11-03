/// <reference lib="webworker" />

import {
  decodeImageLuma,
  type ImageLumaRequest,
  type ImageLumaResponse,
} from './image-luma-decode';

self.onmessage = (event: MessageEvent<ImageLumaRequest>): void => {
  void decodeImageLuma(event.data, {
    createImageBitmap: (image, options) => self.createImageBitmap(image, options),
    createContext: (width, height) =>
      new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }),
  }).then(post, (error: unknown) =>
    post({ kind: 'fallback', reason: error instanceof Error ? error.message : String(error) }),
  );
};

function post(response: ImageLumaResponse): void {
  self.postMessage(response);
}
