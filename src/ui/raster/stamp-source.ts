import { applyImageMaskToLuma } from '../../core/raster';
import { assertStampDimensions, type StampSourcePixels } from '../../core/raster/stamp-height';
import type { Project, RasterImage } from '../../core/scene';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import {
  buildBitmapFromVectors,
  bitmapConversionTarget,
  estimateBitmapConversion,
} from './vector-to-bitmap';
import {
  canPrepareStamp,
  isClosedStampVector,
  stampSourceSelection,
} from './stamp-source-selection';

export { canPrepareStamp };

export type PreparedStampSource = {
  readonly image: RasterImage;
  readonly pixels: StampSourcePixels;
};
export async function prepareStampSource(
  project: Project,
  ids: readonly string[],
  dpi: number,
  signal: AbortSignal,
): Promise<PreparedStampSource> {
  const selection = stampSourceSelection(project.scene, ids);
  const objects = selection.objects;
  if (!selection.canPrepare)
    throw new Error(
      objects.length === 0 && selection.notice !== ''
        ? selection.notice
        : 'Select one raster image or only closed vector artwork. Open paths cannot define a raised face.',
    );
  const first = objects[0];
  if (first?.kind !== 'raster-image') {
    const plan = estimateBitmapConversion(
      bitmapConversionTarget(objects.filter(isClosedStampVector)),
      dpi,
    );
    assertStampDimensions(plan.pixelWidth, plan.pixelHeight);
  }
  const image =
    first?.kind === 'raster-image'
      ? await hydratePagedRasterImage(first, undefined, signal)
      : await buildBitmapFromVectors(
          objects.filter(isClosedStampVector),
          { dpi, renderType: 'fill-all', brightnessPercent: 0 },
          signal,
        );
  signal.throwIfAborted();
  assertStampDimensions(image.pixelWidth, image.pixelHeight);
  const luma = decodeStampLuma(image);
  const maskObject = project.scene.objects.find((object) => object.id === image.imageMaskId);
  if (image.imageMaskId !== undefined && maskObject === undefined)
    throw new Error(
      'The source image mask is unavailable. Repair or remove the mask before preparing a stamp.',
    );
  const masked = applyImageMaskToLuma({
    image,
    maskObject,
    luma,
    width: image.pixelWidth,
    height: image.pixelHeight,
  });
  return {
    image,
    pixels: {
      width: image.pixelWidth,
      height: image.pixelHeight,
      widthMm: (image.bounds.maxX - image.bounds.minX) * Math.abs(image.transform.scaleX),
      heightMm: (image.bounds.maxY - image.bounds.minY) * Math.abs(image.transform.scaleY),
      luma: masked,
    },
  };
}
function decodeStampLuma(image: RasterImage): Uint8Array {
  if (image.lumaBase64 === undefined)
    throw new Error('Source has no full-resolution pixel data. Import the image again.');
  const binary = atob(image.lumaBase64);
  if (binary.length !== image.pixelWidth * image.pixelHeight)
    throw new Error('Source pixel bytes do not match its dimensions.');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
