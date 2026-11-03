import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../../core/effective-output';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import { decodeRasterLuma } from '../../core/job/raster-luma-decode';
import { rasterCompilationPowerScale } from '../../core/raster/controller-power-scale';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import { lumaHistogram } from '../../core/raster/portrait-auto-tones';
import { compiledRasterPreview } from '../workspace/compiled-raster-preview';
import { photoEngravingPreviewInputError } from './photo-engraving-preview-budget';
import { photoMaterialPreview } from './photo-material-preview';
import {
  photoPreviewMaxEdge,
  type PhotoEngravingPreviewInput,
  type PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';

export type {
  PhotoEngravingPreviewInput,
  PhotoEngravingPreviewResult,
} from './photo-engraving-preview-types';

/** Run in the photo worker: compile at the real grid, then reduce only display. */
export function computePhotoEngravingPreview(
  input: PhotoEngravingPreviewInput,
  requestedMaxEdge?: number,
): PhotoEngravingPreviewResult {
  const maxEdge = photoPreviewMaxEdge(requestedMaxEdge);
  const error = photoEngravingPreviewInputError(input, maxEdge);
  if (error !== null) return { kind: 'error', message: error };
  try {
    const compiled = compileRasterGroupsForLayer([input.image], input.layer, input.device, {
      sceneObjects: input.sceneObjects,
    });
    const group = compiled.groups[0];
    if (group === undefined)
      return { kind: 'error', message: 'No photo engraving pixels were compiled.' };
    // The normal toolpath preview stays on absolute machine power. This
    // optional photo view describes the distribution of marks: each full
    // requested dot is black. Only the display reference changes; compile
    // receives the actual device and preserves controller quantization.
    const layer = effectiveOperationForObject(input.layer, input.image);
    const compilationScale = rasterCompilationPowerScale(input.device);
    const maximum = Math.round(
      (effectiveObjectPowerPercent(layer, input.image) / 100) * compilationScale,
    );
    const displayPower =
      compilationScale > 0 ? (maximum / compilationScale) * input.device.maxPowerS : 0;
    const preview = compiledRasterPreview(
      group,
      { ...input.device, maxPowerS: displayPower },
      maxEdge,
    );
    const material =
      input.materialView === true
        ? photoMaterialPreview(group, input.device, displayPower, preview)
        : null;
    return {
      kind: 'ok',
      rgba: preview.rgba,
      ...(material === null
        ? {}
        : { materialRgba: material.rgba, materialSpread: material.spread }),
      sourceHistogram: burnedSourceHistogram(input),
      width: preview.width,
      height: preview.height,
      sourceWidth: preview.sourceWidth,
      sourceHeight: preview.sourceHeight,
      displayDecimated: preview.displayDecimated,
      bounds: group.bounds,
      scanAngleDeg: group.scanAngleDeg ?? 0,
      scanCount: compiled.groups.length,
      scanPasses: compiled.groups.reduce((total, scan) => total + scan.passes, 0),
      normalization: 'relative-marks',
    };
  } catch (cause) {
    return { kind: 'error', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

// Auto tones reads the pixels that can burn. Compile whitens the pixels a mask
// or the image's own clip keeps from burning, and white is left out of the
// tones, so those pixels are left out here too (rolling audit v9 R8-P3-2).
function burnedSourceHistogram(input: PhotoEngravingPreviewInput): Uint32Array<ArrayBuffer> {
  const { image } = input;
  const luma = decodeRasterLuma(image);
  const maskObject =
    image.imageMaskId === undefined
      ? null
      : (input.sceneObjects.find((object) => object.id === image.imageMaskId) ?? null);
  const burns = createImageMaskPixelTest(image, maskObject, image.pixelWidth, image.pixelHeight);
  if (burns === null) return lumaHistogram(luma);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < image.pixelHeight; y += 1) {
    for (let x = 0; x < image.pixelWidth; x += 1) {
      const level = luma[y * image.pixelWidth + x];
      if (level !== undefined && burns(x, y)) histogram[level] = (histogram[level] ?? 0) + 1;
    }
  }
  return histogram;
}
