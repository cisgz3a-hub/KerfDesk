// Masked photos whose mask lies off them, wholly or in part (ADR-633
// Amendments 2 and 3; rolling audits v4 H5-P1-1 and v5 J9-P1-1).
//
// Apply Mask to Image burns only the pixels inside the mask shape. A photo
// whose mask is somewhere else, such as a jig copy still pointing at the
// first outline's mask, burns nothing at all. One that reaches only part of
// its mask, such as an Array on board tile left on the original's mask, burns
// only that part. The design canvas draws a photo without its external mask,
// so it looks ready. Advisory only (rule 7, ADR-565): the job still runs as
// drawn.
//
// The test measures how much of the mask's area (even-odd, as compile fills
// it) lies on the image's rectangle, on sampled rows across the mask. A mask
// with a sliver of overhang is not named, and neither is a mask the image
// covers whole.

import {
  applyTransform,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type AABB,
  type Project,
  type RasterImage,
  type Vec2,
} from '../scene';
// Deep imports: the raster barrel only exports what compile needs.
import { closedMaskContours } from '../raster/image-mask';
import { maskRowCrossings, type MaskContours } from '../raster/mask-scanline';
import type { PreflightIssue } from './preflight';

/** Share of a mask's area that may hang off its image before Job Review names it. */
export const MASK_OVERHANG_TOLERANCE = 0.05;
const COVERAGE_ROWS = 128;

type PartlyMasked = { readonly image: RasterImage; readonly share: number };

export function imageMaskOffImageIssues(project: Project): ReadonlyArray<PreflightIssue> {
  const { scene } = project;
  const outputLayers = scene.layers.flatMap(outputOperationLayers);
  const objectsById = new Map(scene.objects.map((object) => [object.id, object] as const));
  const missed: RasterImage[] = [];
  const partly: PartlyMasked[] = [];
  for (const object of scene.objects) {
    if (object.kind !== 'raster-image' || object.imageMaskId === undefined) continue;
    if (!outputLayers.some((layer) => sceneObjectUsesOperation(object, layer))) continue;
    const mask = objectsById.get(object.imageMaskId);
    // A missing mask, or one with no closed shape, masks nothing.
    const share = mask === undefined ? null : maskShareOnImage(closedMaskContours(mask), object);
    if (share === null) continue;
    if (share <= 0) missed.push(object);
    else if (share < 1 - MASK_OVERHANG_TOLERANCE) partly.push({ image: object, share });
  }
  if (missed.length === 0 && partly.length === 0) return [];
  const message = [offImageSentence(missed), partlyOffSentence(partly)]
    .filter((sentence) => sentence !== '')
    .join(' ');
  return [
    {
      code: 'image-mask-off-image',
      message: `${message} Move each mask over its image, or use Remove Image Mask.`,
    },
  ];
}

function offImageSentence(images: ReadonlyArray<RasterImage>): string {
  if (images.length === 0) return '';
  const names = images.map(imageName);
  const which =
    images.length === 1
      ? `The image ${names[0]} is masked by a shape that does not overlap it`
      : `${images.length} images (${names.join(', ')}) are masked by shapes that do not overlap them`;
  return `${which}, so nothing of ${images.length === 1 ? 'it' : 'them'} will be engraved.`;
}

function partlyOffSentence(entries: ReadonlyArray<PartlyMasked>): string {
  const [first] = entries;
  if (first === undefined) return '';
  if (entries.length === 1) {
    return (
      `Only ${percent(first.share)} of the mask over ${imageName(first.image)} lies on the ` +
      'image, so only that part of the mask shape will be engraved.'
    );
  }
  const listed = entries.map((entry) => `${imageName(entry.image)} ${percent(entry.share)}`);
  return (
    `${entries.length} images lie on only part of their masks (${listed.join(', ')}), so only ` +
    'those parts of the mask shapes will be engraved.'
  );
}

const imageName = (image: RasterImage): string => `"${image.name ?? image.source}"`;
// Never "0%" for a mask that does reach its image.
const percent = (share: number): string => `${Math.max(1, Math.round(share * 100))}%`;

/**
 * Share of the mask's area that lies on the image's rectangle, from 0 to 1,
 * or null for a mask with no area to measure.
 */
export function maskShareOnImage(contours: MaskContours, image: RasterImage): number | null {
  const maskBox = contoursBox(contours);
  if (maskBox === null || maskBox.maxY <= maskBox.minY) return null;
  const footprint = imageFootprint(image);
  const imageBox = contoursBox([footprint]);
  // Boxes that only touch share no area, so no pixel centre lies in both.
  if (imageBox === null || !boxesOverlap(maskBox, imageBox)) return 0;
  if (boxCorners(maskBox).every((corner) => insideConvex(footprint, corner))) return 1;
  let maskLength = 0;
  let onImageLength = 0;
  const rowStep = (maskBox.maxY - maskBox.minY) / COVERAGE_ROWS;
  for (let row = 0; row < COVERAGE_ROWS; row += 1) {
    const y = maskBox.minY + (row + 0.5) * rowStep;
    const lengths = rowLengths(maskRowCrossings(contours, y), maskRowCrossings([footprint], y));
    maskLength += lengths.mask;
    onImageLength += lengths.onImage;
  }
  return maskLength > 0 ? onImageLength / maskLength : null;
}

// One row: the mask's even-odd spans, and how much of them the image's chord holds.
function rowLengths(
  spans: Float64Array,
  chord: Float64Array,
): { readonly mask: number; readonly onImage: number } {
  // A row that misses the image has an empty chord, which holds nothing.
  const chordMin = chord[0] ?? Infinity;
  const chordMax = chord[chord.length - 1] ?? -Infinity;
  let mask = 0;
  let onImage = 0;
  for (let index = 0; index + 1 < spans.length; index += 2) {
    const start = spans[index] ?? 0;
    const end = spans[index + 1] ?? start;
    mask += end - start;
    onImage += Math.max(0, Math.min(end, chordMax) - Math.max(start, chordMin));
  }
  return { mask, onImage };
}

// The image's rectangle in scene space; a convex quad under any transform.
function imageFootprint(image: RasterImage): ReadonlyArray<Vec2> {
  return boxCorners(image.bounds).map((corner) => applyTransform(corner, image.transform));
}

function boxCorners(box: AABB): ReadonlyArray<Vec2> {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

// A point on the image's edge counts as inside: the mask reaches no further.
// Either winding (a mirrored image runs clockwise) keeps one sign throughout.
function insideConvex(quad: ReadonlyArray<Vec2>, point: Vec2): boolean {
  let side = 0;
  for (const [index, a] of quad.entries()) {
    const b = quad[(index + 1) % quad.length] ?? a;
    const cross = Math.sign((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
    if (cross === 0) continue;
    if (side !== 0 && cross !== side) return false;
    side = cross;
  }
  return true;
}

function contoursBox(contours: MaskContours): AABB | null {
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

function boxesOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}
