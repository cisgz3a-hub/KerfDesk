import { applyImageMaskToLuma } from '../../core/raster';
import { assertStampDimensions, type StampSourcePixels } from '../../core/raster/stamp-height';
import type { Project, RasterImage, SceneObject } from '../../core/scene';
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import {
  buildBitmapFromVectors,
  bitmapConversionTarget,
  estimateBitmapConversion,
  isConvertibleVector,
  type ConvertibleVector,
} from './vector-to-bitmap';

export type PreparedStampSource = {
  readonly image: RasterImage;
  readonly pixels: StampSourcePixels;
};
export function canPrepareStamp(objects: ReadonlyArray<SceneObject>): boolean {
  return (
    objects.length > 0 &&
    ((objects.length === 1 && objects[0]?.kind === 'raster-image') ||
      objects.every(isClosedStampVector))
  );
}
export async function prepareStampSource(
  project: Project,
  ids: readonly string[],
  dpi: number,
  signal: AbortSignal,
): Promise<PreparedStampSource> {
  const objects = project.scene.objects.filter((object) => ids.includes(object.id));
  if (objects.length !== ids.length || !canPrepareStamp(objects))
    throw new Error(
      'Select one raster image or only closed vector artwork. Open paths cannot define a raised face.',
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
function isClosedStampVector(object: SceneObject): object is ConvertibleVector {
  if (!isConvertibleVector(object) || object.paths.length === 0) return false;
  return object.paths.every((path) => {
    const subpaths = path.curves ?? path.polylines;
    return subpaths.length > 0 && subpaths.every((part) => part.closed);
  });
}
function decodeStampLuma(image: RasterImage): Uint8Array {
  if (image.lumaBase64 === undefined)
    throw new Error('Source has no full-resolution pixel data. Import the image again.');
  const binary = atob(image.lumaBase64);
  if (binary.length !== image.pixelWidth * image.pixelHeight)
    throw new Error('Source pixel bytes do not match its dimensions.');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
