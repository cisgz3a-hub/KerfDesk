import { RGBA_CHANNELS } from '../../core/image-edit';
import type { DeviceProfile } from '../../core/devices';
import type { SelectionMask } from '../../core/image-select';
import { originFlipsRasterX, originFlipsRasterY } from '../../core/raster-output';
import type { RasterImage } from '../../core/scene';
import type { EditorSession } from './editor-session';

const ALPHA_CHANNEL = 3;

/** Inputs for mapping an oriented output mask onto one editor layer. */
export type EditorRasterSourceMaskInput = {
  readonly session: EditorSession;
  readonly object: RasterImage;
  readonly device: DeviceProfile;
  readonly removed: SelectionMask;
  readonly activeIndex: number;
};

/**
 * Map machine-oriented output samples to opaque pixels in the active editor
 * layer. The caller separately proves that no visible upper layer can mask
 * the final repair.
 */
export function editorRasterSourceMask(input: EditorRasterSourceMaskInput): Uint8Array {
  const { session, object, device, removed, activeIndex } = input;
  const alpha = new Uint8Array(session.doc.width * session.doc.height);
  const { isFlipX, isFlipY } = rasterMaskOrientation(object, device);
  for (let outputY = 0; outputY < removed.height; outputY += 1) {
    for (let outputX = 0; outputX < removed.width; outputX += 1) {
      if ((removed.alpha[outputY * removed.width + outputX] ?? 0) === 0) continue;
      const sourceX = isFlipX ? session.doc.width - 1 - outputX : outputX;
      const sourceY = isFlipY ? session.doc.height - 1 - outputY : outputY;
      const pixelIndex = sourceY * session.doc.width + sourceX;
      if (isOpaqueActivePixel(session, activeIndex, pixelIndex)) alpha[pixelIndex] = 255;
    }
  }
  return alpha;
}

/** Orient one editor-grid mask into the exact machine-facing raster grid. */
export function editorRasterOutputMask(
  source: SelectionMask,
  object: RasterImage,
  device: DeviceProfile,
): SelectionMask {
  const { isFlipX, isFlipY } = rasterMaskOrientation(object, device);
  const alpha = new Uint8Array(source.alpha.length);
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const outputX = isFlipX ? source.width - 1 - sourceX : sourceX;
      const outputY = isFlipY ? source.height - 1 - sourceY : sourceY;
      alpha[outputY * source.width + outputX] = source.alpha[sourceY * source.width + sourceX] ?? 0;
    }
  }
  return { width: source.width, height: source.height, alpha };
}

function isOpaqueActivePixel(
  session: EditorSession,
  activeIndex: number,
  pixelIndex: number,
): boolean {
  const active = session.layers[activeIndex];
  return (
    active !== undefined &&
    (active.buffer.data[pixelIndex * RGBA_CHANNELS + ALPHA_CHANNEL] ?? 0) === 255
  );
}

function isObjectRasterXFlipped(object: RasterImage): boolean {
  return object.transform.mirrorX !== object.transform.scaleX < 0;
}

function isObjectRasterYFlipped(object: RasterImage): boolean {
  return object.transform.mirrorY !== object.transform.scaleY < 0;
}

function rasterMaskOrientation(
  object: RasterImage,
  device: DeviceProfile,
): { readonly isFlipX: boolean; readonly isFlipY: boolean } {
  return {
    isFlipX: originFlipsRasterX(device) !== isObjectRasterXFlipped(object),
    isFlipY: originFlipsRasterY(device) !== isObjectRasterYFlipped(object),
  };
}
