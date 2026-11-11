// ADR-699 Job Review wording for 3D Sliced images and ramped Fills, split out
// of job-review-detail-facts.ts to keep that file under the size cap.

import { isSlicedImageOperation } from '../../../core/job/compile-job-raster-sliced';
import { fillRampApplies } from '../../../core/job/fill-ramp';
import { imageSliceCount } from '../../../core/raster/slice-3d';
import type { LayerOperationSettings } from '../../../core/scene';
import { formatMm } from './job-review-format';

/** 3D Sliced burns one pass per slice, so the pass count is the depth
 * resolution, and Job Review says so. Null for any other image mode; a 3D
 * Sliced image under Pass-Through burns as Grayscale and is named as a dither. */
export function slicedImagePart(settings: LayerOperationSettings): string | null {
  if (!isSlicedImageOperation(settings)) {
    return settings.ditherAlgorithm === '3d-sliced' ? '3D Sliced dither' : null;
  }
  const slices = imageSliceCount(settings.passes);
  const passes = slices === 1 ? 'pass' : 'passes';
  const scans = settings.imageCrossHatch === true ? ', each scanned twice (cross-hatch)' : '';
  return `3D Sliced: ${slices} ${passes}, one slice each${scans}, darker burned deeper`;
}

/** The ramp grades power from Min power at the edges, so both show. */
export function fillRampParts(settings: LayerOperationSettings): ReadonlyArray<string> {
  if (!fillRampApplies(settings)) return [];
  return [
    `ramp ${formatMm(settings.fillRampLengthMm ?? 0)} mm from min power ${settings.minPower}%`,
    settings.fillRampOuterEdge === true ? 'outer edge ramped' : 'outer edge square',
  ];
}
