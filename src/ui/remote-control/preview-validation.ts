import {
  applyTransform,
  type ColoredPath,
  type CurveSubpath,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { isVectorSceneObject, type VectorSceneObject } from '../workspace/object-display';
import { remoteBounds } from './projections';
import { transformedBBox } from '../../core/scene/hit-test';

export const PREVIEW_POINT_LIMIT = 50_000;
export class PreviewUnavailable extends Error {}
export type PreviewPointBudget = { points: number };
export type PreviewImageFootprint = { readonly corners: readonly Vec2[] };

/** Placement only. Never read an image's source, pixels, thumbnail or asset references. */
export function validatedPreviewImageFootprint(
  object: Extract<SceneObject, { kind: 'raster-image' }>,
  budget: PreviewPointBudget,
): PreviewImageFootprint {
  validateTransform(object);
  const { minX, minY, maxX, maxY } = object.bounds;
  if (![minX, minY, maxX, maxY].every(bounded) || minX > maxX || minY > maxY) invalidGeometry();
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((point) => applyTransform(point, object.transform));
  if (!corners.every(validPreviewPoint)) invalidGeometry();
  reservePreviewPoints(budget, corners.length);
  return { corners };
}

export function validatedPreviewObject(
  object: SceneObject,
  budget: PreviewPointBudget,
): VectorSceneObject {
  if (!isVectorSceneObject(object))
    throw new PreviewUnavailable(
      'Remote previews support vector artwork, outlined text and image placement frames. Reliefs must be viewed on the PC.',
    );
  validateTransform(object);
  if (object.kind === 'text' && object.content.trim() !== '' && object.paths.length === 0)
    throw new PreviewUnavailable(
      'Text outlines are not ready. Finish editing the text on the PC first.',
    );
  if (remoteBounds(transformedBBox(object)) === undefined)
    throw new PreviewUnavailable(
      'The artwork has invalid or oversized bounds. Check it on the PC.',
    );
  for (const path of object.paths) validatePath(path, budget);
  return object;
}

function validateTransform(object: SceneObject): void {
  if (
    !Object.values(object.transform).every((value) => typeof value === 'boolean' || bounded(value))
  )
    invalidGeometry();
}

function validatePath(path: ColoredPath, budget: PreviewPointBudget): void {
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(path.color))
    throw new PreviewUnavailable(
      'The artwork has an unsupported display colour. Check it on the PC.',
    );
  for (const polyline of path.polylines) {
    reservePreviewPoints(budget, polyline.points.length);
    if (!polyline.points.every(validPreviewPoint)) invalidGeometry();
  }
  for (const curve of path.curves ?? []) {
    reservePreviewPoints(budget, curve.segments.length + 1);
    if (!validPreviewPoint(curve.start)) invalidGeometry();
    curve.segments.forEach(validateSegment);
  }
}
function validateSegment(segment: CurveSubpath['segments'][number]): void {
  if (!validPreviewPoint(segment.to)) invalidGeometry();
  if (segment.kind === 'cubic') {
    if (!validPreviewPoint(segment.control1) || !validPreviewPoint(segment.control2))
      invalidGeometry();
  } else if (segment.kind === 'elliptical-arc') {
    if (![segment.radiusX, segment.radiusY, segment.rotationDeg].every(bounded)) invalidGeometry();
  } else if (segment.kind !== 'line') invalidGeometry();
}
export function reservePreviewPoints(budget: PreviewPointBudget, count: number): void {
  budget.points += count;
  if (budget.points > PREVIEW_POINT_LIMIT) previewTooLarge();
}
function bounded(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000;
}
export function validPreviewPoint(point: Vec2): boolean {
  return bounded(point.x) && bounded(point.y);
}
export function previewTooLarge(): never {
  throw new PreviewUnavailable(
    'This workspace has too much geometry for a remote artwork preview. View it on the PC.',
  );
}
export function invalidGeometry(): never {
  throw new PreviewUnavailable('The artwork has invalid geometry. Check it on the PC.');
}
