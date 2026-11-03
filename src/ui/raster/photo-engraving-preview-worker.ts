/// <reference lib="webworker" />

import { computePhotoEngravingPreview } from './photo-engraving-preview';
import type { PhotoEngravingPreviewResult } from './photo-engraving-preview-types';
import type {
  PhotoEngravingPreviewWorkerRequest,
  PhotoEngravingPreviewWorkerResponse,
} from './photo-engraving-preview-worker-protocol';

self.onmessage = (event: MessageEvent<PhotoEngravingPreviewWorkerRequest>): void => {
  const { id, input, maxEdge } = event.data;
  const result = computePhotoEngravingPreview(input, maxEdge);
  const response: PhotoEngravingPreviewWorkerResponse = { id, result };
  self.postMessage(response, previewTransfers(result));
};

function previewTransfers(result: PhotoEngravingPreviewResult): ArrayBuffer[] {
  if (result.kind === 'error') {
    return result.sourceHistogram === undefined ? [] : [result.sourceHistogram.buffer];
  }
  return [
    result.rgba.buffer,
    result.sourceHistogram.buffer,
    ...(result.materialRgba === undefined ? [] : [result.materialRgba.buffer]),
  ];
}
