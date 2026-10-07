/// <reference lib="webworker" />
import { prepareStampHeight } from '../../core/raster/stamp-height';
import type { VectorRaster } from '../../core/raster';
import { lumaToBase64, lumaToRgba } from './luma-bitmap';
import type { StampWorkerRequest, StampWorkerResponse } from './stamp-worker-protocol';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<StampWorkerRequest>): void => {
  void buildDraft(event.data).then((response) => scope.postMessage(response));
};
async function buildDraft({ source, request }: StampWorkerRequest): Promise<StampWorkerResponse> {
  try {
    const draft = prepareStampHeight(source, request);
    const { face, luma, ...metadata } = draft;
    const dataUrl = await encode({ width: draft.width, height: draft.height, luma });
    const faceDataUrl = await encode({
      width: draft.width,
      height: draft.height,
      luma: face.map((value) => (value === 1 ? 0 : 255)),
    });
    const sourceDataUrl = await encode(source);
    return {
      kind: 'ok',
      draft: { ...metadata, dataUrl, lumaBase64: lumaToBase64(luma), sourceDataUrl, faceDataUrl },
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Stamp preparation failed.',
    };
  }
}
async function encode(raster: VectorRaster): Promise<string> {
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not create a stamp preview canvas.');
  context.putImageData(new ImageData(lumaToRgba(raster), raster.width, raster.height), 0, 0);
  return new FileReaderSync().readAsDataURL(await canvas.convertToBlob({ type: 'image/png' }));
}
