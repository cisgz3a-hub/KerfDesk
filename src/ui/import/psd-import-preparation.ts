import { decodePsdComposite } from '../../io/psd/decode-psd';
import { readPsdHeader } from '../../io/psd/psd-structure';
import { resampleBuffer } from '../../core/image-resample';
import type { ImageDensity } from '../common/image-density';
import {
  burnDecodeMaxEdge,
  compositeRgbOverWhitePreservingAlpha,
  extractLumaBase64,
  scaleToCap,
} from '../trace/image-loader';
import { bytesToBase64 } from './base64-bytes';

export type PreparedPsdImport = {
  readonly natural: { readonly width: number; readonly height: number };
  readonly sampled: { readonly width: number; readonly height: number };
  readonly density: ImageDensity | null;
  readonly dataUrl: string;
  readonly lumaBase64: string;
  readonly hasColorProfile: boolean;
};

/** Called only inside the queued worker: file read, decode, sample and PNG encode. */
export async function preparePsdImport(blob: Blob): Promise<PreparedPsdImport> {
  readPsdHeader(new Uint8Array(await blob.slice(0, 26).arrayBuffer()));
  const image = await decodePsdComposite(new Uint8Array(await blob.arrayBuffer()));
  const natural = { width: image.width, height: image.height };
  const sampled = scaleToCap(
    image.width,
    image.height,
    burnDecodeMaxEdge(image.width, image.height),
  );
  const samples =
    sampled.width === image.width && sampled.height === image.height
      ? image
      : resampleBuffer(image, sampled.width, sampled.height);
  const lumaBase64 = extractLumaBase64(compositeRgbOverWhitePreservingAlpha(samples));
  const canvas = new OffscreenCanvas(image.width, image.height);
  try {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Could not encode the PSD composite image.');
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    if (png.size === 0 || png.type !== 'image/png')
      throw new Error('PSD composite PNG encoding failed.');
    return {
      natural,
      sampled,
      lumaBase64,
      hasColorProfile: image.hasColorProfile,
      density: image.dpi === undefined ? null : { xDpi: image.dpi.x, yDpi: image.dpi.y },
      dataUrl: `data:image/png;base64,${bytesToBase64(new Uint8Array(await png.arrayBuffer()))}`,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
