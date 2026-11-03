/// <reference lib="webworker" />

import {
  lumaFromDrawnImage,
  type ImageLumaRequest,
  type ImageLumaResponse,
} from './image-luma-decode';

self.onmessage = (event: MessageEvent<ImageLumaRequest>): void => {
  const response: ImageLumaResponse = lumaFromDrawnImage(event.data.bitmap, (width, height) =>
    new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }),
  );
  self.postMessage(response);
};
