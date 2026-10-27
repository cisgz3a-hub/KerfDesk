// Crop Image and Flatten Image Mask keep the mask's shape as the image's own
// clip (ADR-480 Amendment 1; rolling audit v4, H5-P2-1).
//
// The live mask hides the pixels outside it after brightness, Negative and the
// tone curve have run, so they never burn. Baked to white alone they would:
// Negative turns white into full power. An owned clip (`imageClip`) is applied
// at the same point as the live mask, so the baked image burns what the masked
// one did under every setting, and the canvas shows it in the mask's shape.

import { intersectClosedPolylinesChecked } from '../geometry/polygon-intersection';
import { invertAffine, transformAffine } from '../geometry/shear-bake';
import {
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { applyAffine } from '../vector-export/affine-curves';
import { closedImageClipContours, closedMaskContours } from './image-mask';

/**
 * The mask's closed shape in the image's local frame, intersected with any
 * clip the image already owns, as one even-odd clip. Null when the image's
 * transform has no inverse or the two clips cannot be combined.
 */
export function bakedImageMaskClip(
  image: RasterImage,
  maskObject: SceneObject,
): ReadonlyArray<ColoredPath> | null {
  const toLocal = invertAffine(transformAffine(image.transform));
  if (toLocal === null) return null;
  const mask: Polyline[] = closedMaskContours(maskObject).map((contour) => ({
    points: contour.map((point) => applyAffine(toLocal, point)),
    closed: true,
  }));
  if (image.imageClip === undefined) return [clipPath(mask)];
  const owned = closedImageClipContours(image.imageClip).map((points) => ({
    points,
    closed: true,
  }));
  const both = intersectClosedPolylinesChecked(owned, mask);
  return both.kind === 'error' ? null : [clipPath(both.value)];
}

// The shape SVG import gives a clip it flattens (ADR-358 Amendment 2).
function clipPath(polylines: ReadonlyArray<Polyline>): ColoredPath {
  return {
    color: '#000000',
    fillRule: 'evenodd',
    polylines,
    curves: polylines.map(polylineToCurveSubpath),
  };
}
