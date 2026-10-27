// Masked photos whose mask lies wholly off them (ADR-633 Amendment 2; rolling
// audit v4, H5-P1-1).
//
// Apply Mask to Image burns only the pixels inside the mask shape. A photo
// whose mask is somewhere else, such as a jig copy still pointing at the
// first outline's mask, burns nothing at all. The design canvas draws a photo
// without its external mask, so it looks ready. Advisory only (rule 7,
// ADR-565): the job still runs as drawn.
//
// The test compares bounding boxes, so it never warns about a mask that
// reaches the photo. A mask whose box overlaps the photo's box without its
// shape touching the photo is not reported.

import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  transformedBBox,
  type AABB,
  type Project,
  type RasterImage,
} from '../scene';
// Deep import: the raster barrel only exports what compile needs.
import { closedMaskContours } from '../raster/image-mask';
import type { PreflightIssue } from './preflight';

export function imageMaskOffImageIssues(project: Project): ReadonlyArray<PreflightIssue> {
  const { scene } = project;
  const outputLayers = scene.layers.flatMap(outputOperationLayers);
  const objectsById = new Map(scene.objects.map((object) => [object.id, object] as const));
  const missed: RasterImage[] = [];
  for (const object of scene.objects) {
    if (object.kind !== 'raster-image' || object.imageMaskId === undefined) continue;
    if (!outputLayers.some((layer) => sceneObjectUsesOperation(object, layer))) continue;
    const mask = objectsById.get(object.imageMaskId);
    // A missing mask, or one with no closed shape, masks nothing.
    const maskBox = mask === undefined ? null : contoursBox(closedMaskContours(mask));
    if (maskBox !== null && !boxesOverlap(maskBox, transformedBBox(object))) missed.push(object);
  }
  if (missed.length === 0) return [];
  return [{ code: 'image-mask-off-image', message: offImageMessage(missed) }];
}

function offImageMessage(images: ReadonlyArray<RasterImage>): string {
  const names = images.map((image) => `"${image.name ?? image.source}"`);
  const which =
    images.length === 1
      ? `The image ${names[0]} is masked by a shape that does not overlap it`
      : `${images.length} images (${names.join(', ')}) are masked by shapes that do not overlap them`;
  return (
    `${which}, so nothing of ${images.length === 1 ? 'it' : 'them'} will be engraved. ` +
    'Move each mask over its image, or use Remove Image Mask.'
  );
}

function contoursBox(contours: ReturnType<typeof closedMaskContours>): AABB | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const point of contour) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

// Boxes that only touch share no area, so no pixel centre lies in both.
function boxesOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}
