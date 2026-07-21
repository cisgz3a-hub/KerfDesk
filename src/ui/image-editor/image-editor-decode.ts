// Decode a RasterImage's stored dataUrl into the editor's RGBA working
// document, and bake the edited document back to the RasterImage fields
// (ADR-242 Apply contract: new dataUrl + re-derived luma, dimensions
// unchanged, mm bounds untouched). Reuses the trace loader's decode path and
// luma derivation so the editor sees exactly the pixels trace/engrave see.

import type { RgbaBuffer } from '../../core/image-edit';
import type { RasterImage } from '../../core/scene';
import { extractLumaBase64, loadImageAsRawData, readFileAsDataUrl } from '../trace/image-loader';
import type { BitmapFields } from './image-editor-types';

const EDITOR_DECODE_FILENAME = 'image-studio-source';

export async function decodeRasterToBuffer(image: RasterImage): Promise<RgbaBuffer> {
  const response = await fetch(image.dataUrl);
  const blob = await response.blob();
  const file = new File([blob], EDITOR_DECODE_FILENAME, { type: blob.type });
  // Native resolution: the stored pixel dims are already inside the import
  // caps, so the cap argument only prevents an unexpected upscale.
  const maxEdge = Math.max(image.pixelWidth, image.pixelHeight, 1);
  return loadImageAsRawData(file, maxEdge);
}

export async function bakeBufferToBitmapFields(doc: RgbaBuffer): Promise<BitmapFields> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Could not create a 2D canvas to encode the edited image.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(doc.data), doc.width, doc.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    // Async encode (never the sync toDataURL string path — RESEARCH_LOG
    // 2026-06-04 memory-pressure finding).
    canvas.toBlob((result) => {
      if (result === null) reject(new Error('PNG encode failed for the edited image.'));
      else resolve(result);
    }, 'image/png');
  });
  const dataUrl = await readFileAsDataUrl(new File([blob], 'edited.png', { type: 'image/png' }));
  const lumaBase64 = extractLumaBase64({ width: doc.width, height: doc.height, data: doc.data });
  return { dataUrl, lumaBase64 };
}
