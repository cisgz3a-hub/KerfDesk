import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import { cutSides } from '../../core/geometry/cut-shape-sides';
import { closedImageClipContours, closedMaskContours } from '../../core/raster/image-mask';
import {
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { boundsFromColoredPaths } from '../../core/trace';
import type { TraceResult } from './use-trace-worker-client';

/** Tone inversion and smoothing may extend paths into paper. Keep the mask's
 * exact local geometry as the final output boundary, including open traces. */
export function clipTraceResultToMask(
  result: TraceResult,
  image: RasterImage,
  maskObject?: SceneObject,
): TraceResult {
  let paths = result.paths;
  for (const contours of maskRegions(image, maskObject, result)) {
    if (contours.length === 0) {
      paths = [];
      continue;
    }
    const cutter = unionD(contours, [], FillRule.EvenOdd, 3);
    const clipped = cutSides(
      {
        kind: 'imported-svg',
        id: 'trace-mask-result',
        source: image.source,
        transform: IDENTITY_TRANSFORM,
        bounds: result.bounds,
        paths,
      },
      cutter,
    );
    if (clipped.kind === 'error') throw new Error(clipped.error.message);
    // Preserve canonical curves when the mask did not cut the result.
    if (clipped.value.outside.length > 0) paths = [...clipped.value.inside];
  }
  return paths === result.paths
    ? result
    : { ...result, paths, bounds: boundsFromColoredPaths(paths) };
}

function maskRegions(
  image: RasterImage,
  maskObject: SceneObject | undefined,
  grid: { readonly width: number; readonly height: number },
): readonly PathsD[] {
  const regions: PathsD[] = [];
  const toGrid = (point: Vec2): Vec2 => ({
    x: ((point.x - image.bounds.minX) * grid.width) / (image.bounds.maxX - image.bounds.minX),
    y: ((point.y - image.bounds.minY) * grid.height) / (image.bounds.maxY - image.bounds.minY),
  });
  if (image.bounds.maxX <= image.bounds.minX || image.bounds.maxY <= image.bounds.minY)
    throw new Error('The image mask cannot be mapped onto an empty image bounds.');
  if (image.imageClip !== undefined)
    regions.push(closedImageClipContours(image.imageClip).map((contour) => contour.map(toGrid)));
  if (image.imageMaskId !== undefined && maskObject?.id === image.imageMaskId) {
    const external = closedMaskContours(maskObject);
    // The shared engraving test ignores an absent or non-closed external mask.
    if (external.length > 0)
      regions.push(
        external.map((contour) => contour.map((point) => toGrid(scenePointToImage(point, image)))),
      );
  }
  return regions;
}

function scenePointToImage(point: Vec2, image: RasterImage): Vec2 {
  const transform = image.transform;
  if (
    !Number.isFinite(transform.scaleX) ||
    !Number.isFinite(transform.scaleY) ||
    transform.scaleX === 0 ||
    transform.scaleY === 0
  )
    throw new Error('The external mask cannot be mapped through this image transform.');
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const dx = point.x - transform.x,
    dy = point.y - transform.y;
  const x = (dx * Math.cos(radians) + dy * Math.sin(radians)) / transform.scaleX;
  const y = (-dx * Math.sin(radians) + dy * Math.cos(radians)) / transform.scaleY;
  return { x: transform.mirrorX ? -x : x, y: transform.mirrorY ? -y : y };
}
