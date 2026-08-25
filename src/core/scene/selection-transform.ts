import { combinedBBox, type AABB } from './hit-test';
import { applyTransform } from './transform';
import type { SceneObject, Transform, Vec2 } from './scene-object';

const MIN_DIMENSION_MM = 0.000001;
const ROTATION_EPSILON_DEG = 0.000001;
const HALF_TURN_DEG = 180;
const FULL_TURN_DEG = 360;

export type SelectionAnchor = 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se';

export type SelectionTransform = {
  readonly id: string;
  readonly transform: Transform;
};

export type SelectionFlipAxis = 'horizontal' | 'vertical';

export type SelectionMetrics = {
  readonly bbox: AABB;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number | null;
  readonly count: number;
};

export type SelectionTransformEdit =
  | {
      readonly kind: 'position';
      readonly anchor: SelectionAnchor;
      readonly x?: number;
      readonly y?: number;
    }
  | {
      readonly kind: 'resize';
      readonly anchor: SelectionAnchor;
      readonly width?: number;
      readonly height?: number;
      readonly preserveAspect: boolean;
      /** Optional selection-local frame. Non-uniform scaling stays representable
       * for rotated artwork by scaling along these axes instead of world X/Y. */
      readonly frameRotationDeg?: number;
    }
  // Rotation always pivots about the selection centre, so it carries NO anchor:
  // the 9-dot anchor governs the X/Y reference and the resize corner only.
  // Pivoting rotation at that anchor shifted the artwork off its spot, because
  // the anchor defaults to 'nw' (ui-store.ts) for the X/Y readout's sake.
  | { readonly kind: 'rotate'; readonly rotationDeg: number };

export type SelectionTransformError =
  | 'empty-selection'
  | 'degenerate-selection'
  | 'invalid-dimension'
  | 'invalid-number'
  | 'multi-rotation'
  | 'non-uniform-rotated-selection';

export type SelectionTransformResult =
  | { readonly kind: 'ok'; readonly transforms: ReadonlyArray<SelectionTransform> }
  | { readonly kind: 'error'; readonly reason: SelectionTransformError };

export function selectionMetrics(objects: ReadonlyArray<SceneObject>): SelectionMetrics | null {
  const bbox = combinedBBox(objects);
  if (bbox === null) return null;
  return {
    bbox,
    width: bbox.maxX - bbox.minX,
    height: bbox.maxY - bbox.minY,
    rotationDeg: objects.length === 1 ? normalizeDeg(objects[0]?.transform.rotationDeg ?? 0) : null,
    count: objects.length,
  };
}

/** Measures transformed object bounds after rotating the scene into a caller-
 * supplied frame. A rotated single object therefore reports its local-axis W/H
 * while its world placement and rotation remain untouched. */
export function selectionMetricsInFrame(
  objects: ReadonlyArray<SceneObject>,
  frameRotationDeg: number,
): SelectionMetrics | null {
  if (!Number.isFinite(frameRotationDeg)) return null;
  const bbox = combinedBBoxInFrame(objects, frameRotationDeg);
  if (bbox === null) return null;
  return {
    bbox,
    width: bbox.maxX - bbox.minX,
    height: bbox.maxY - bbox.minY,
    rotationDeg: objects.length === 1 ? normalizeDeg(objects[0]?.transform.rotationDeg ?? 0) : null,
    count: objects.length,
  };
}

export function buildSelectionTransformEdit(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionTransformEdit,
): SelectionTransformResult {
  const metrics = selectionMetrics(objects);
  if (metrics === null) return { kind: 'error', reason: 'empty-selection' };
  if (edit.kind === 'position') return positionSelection(objects, metrics.bbox, edit);
  if (edit.kind === 'resize') return resizeSelection(objects, metrics, edit);
  return rotateSelection(objects, metrics.bbox, edit);
}

export function buildSelectionNudgeEdit(
  objects: ReadonlyArray<SceneObject>,
  dx: number,
  dy: number,
): SelectionTransformResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { kind: 'error', reason: 'invalid-number' };
  }
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: {
        ...object.transform,
        x: object.transform.x + dx,
        y: object.transform.y + dy,
      },
    })),
  };
}

export function buildSelectionFlipEdit(
  objects: ReadonlyArray<SceneObject>,
  axis: SelectionFlipAxis,
): SelectionTransformResult {
  const bbox = combinedBBox(objects);
  if (bbox === null) return { kind: 'error', reason: 'empty-selection' };
  const anchor = anchorPointForBBox(bbox, 'c');
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: flipTransformAboutPoint(object, axis, anchor),
    })),
  };
}

function positionSelection(
  objects: ReadonlyArray<SceneObject>,
  bbox: AABB,
  edit: Extract<SelectionTransformEdit, { readonly kind: 'position' }>,
): SelectionTransformResult {
  const anchor = anchorPointForBBox(bbox, edit.anchor);
  if (!isOptionalFiniteNumber(edit.x) || !isOptionalFiniteNumber(edit.y)) {
    return { kind: 'error', reason: 'invalid-number' };
  }
  const dx = edit.x === undefined ? 0 : edit.x - anchor.x;
  const dy = edit.y === undefined ? 0 : edit.y - anchor.y;
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
    })),
  };
}

function resizeSelection(
  objects: ReadonlyArray<SceneObject>,
  metrics: SelectionMetrics,
  edit: Extract<SelectionTransformEdit, { readonly kind: 'resize' }>,
): SelectionTransformResult {
  if (edit.frameRotationDeg !== undefined && !Number.isFinite(edit.frameRotationDeg)) {
    return { kind: 'error', reason: 'invalid-number' };
  }
  const resizeMetrics = resizeMetricsForFrame(objects, metrics, edit.frameRotationDeg);
  if (resizeMetrics === null || hasDegenerateDimensions(resizeMetrics)) {
    return { kind: 'error', reason: 'degenerate-selection' };
  }
  if (hasInvalidResizeDimension(edit)) {
    return { kind: 'error', reason: 'invalid-dimension' };
  }
  const factors = resizeFactors(resizeMetrics, edit);
  if (rejectsWorldAxisResize(objects, edit, factors)) {
    return { kind: 'error', reason: 'non-uniform-rotated-selection' };
  }
  const anchor = anchorPointForBBox(resizeMetrics.bbox, edit.anchor);
  return {
    kind: 'ok',
    transforms: objects.map((object) => ({
      id: object.id,
      transform: resizeTransform(object.transform, anchor, factors, edit.frameRotationDeg),
    })),
  };
}

function resizeMetricsForFrame(
  objects: ReadonlyArray<SceneObject>,
  metrics: SelectionMetrics,
  frameRotationDeg: number | undefined,
): SelectionMetrics | null {
  return frameRotationDeg === undefined
    ? metrics
    : selectionMetricsInFrame(objects, frameRotationDeg);
}

function hasDegenerateDimensions(metrics: SelectionMetrics): boolean {
  return metrics.width <= MIN_DIMENSION_MM || metrics.height <= MIN_DIMENSION_MM;
}

function hasInvalidResizeDimension(
  edit: Extract<SelectionTransformEdit, { readonly kind: 'resize' }>,
): boolean {
  return invalidDimension(edit.width) || invalidDimension(edit.height);
}

function invalidDimension(value: number | undefined): boolean {
  return value !== undefined && (!Number.isFinite(value) || value <= MIN_DIMENSION_MM);
}

function rejectsWorldAxisResize(
  objects: ReadonlyArray<SceneObject>,
  edit: Extract<SelectionTransformEdit, { readonly kind: 'resize' }>,
  factors: { readonly x: number; readonly y: number },
): boolean {
  return (
    edit.frameRotationDeg === undefined &&
    !edit.preserveAspect &&
    !isUniformScale(factors) &&
    hasRotatedObject(objects)
  );
}

function resizeTransform(
  transform: Transform,
  anchor: Vec2,
  factors: { readonly x: number; readonly y: number },
  frameRotationDeg: number | undefined,
): Transform {
  return frameRotationDeg === undefined
    ? scaleTransformAboutPoint(transform, anchor, factors.x, factors.y)
    : scaleTransformInFrame(transform, anchor, factors.x, factors.y, frameRotationDeg);
}

function rotateSelection(
  objects: ReadonlyArray<SceneObject>,
  bbox: AABB,
  edit: Extract<SelectionTransformEdit, { readonly kind: 'rotate' }>,
): SelectionTransformResult {
  const object = objects[0];
  if (object === undefined) return { kind: 'error', reason: 'empty-selection' };
  if (objects.length !== 1) return { kind: 'error', reason: 'multi-rotation' };
  if (!Number.isFinite(edit.rotationDeg)) return { kind: 'error', reason: 'invalid-number' };
  const anchor = anchorPointForBBox(bbox, 'c');
  const deltaDeg = edit.rotationDeg - object.transform.rotationDeg;
  const origin = rotatePoint({ x: object.transform.x, y: object.transform.y }, anchor, deltaDeg);
  return {
    kind: 'ok',
    transforms: [
      {
        id: object.id,
        transform: {
          ...object.transform,
          x: origin.x,
          y: origin.y,
          rotationDeg: normalizeDeg(edit.rotationDeg),
        },
      },
    ],
  };
}

function resizeFactors(
  metrics: SelectionMetrics,
  edit: Extract<SelectionTransformEdit, { readonly kind: 'resize' }>,
): { readonly x: number; readonly y: number } {
  const x = edit.width === undefined ? 1 : edit.width / metrics.width;
  const y = edit.height === undefined ? 1 : edit.height / metrics.height;
  if (!edit.preserveAspect) return { x, y };
  const uniform = edit.width !== undefined ? x : y;
  return { x: uniform, y: uniform };
}

function anchorPointForBBox(bbox: AABB, anchor: SelectionAnchor): Vec2 {
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;
  const x = anchor.endsWith('w') ? bbox.minX : anchor.endsWith('e') ? bbox.maxX : midX;
  const y = anchor.startsWith('n') ? bbox.minY : anchor.startsWith('s') ? bbox.maxY : midY;
  return { x, y };
}

export function selectionAnchorPoint(bbox: AABB, anchor: SelectionAnchor): Vec2 {
  return anchorPointForBBox(bbox, anchor);
}

function scaleTransformAboutPoint(
  transform: Transform,
  anchor: Vec2,
  factorX: number,
  factorY: number,
): Transform {
  return {
    ...transform,
    x: anchor.x + (transform.x - anchor.x) * factorX,
    y: anchor.y + (transform.y - anchor.y) * factorY,
    scaleX: transform.scaleX * factorX,
    scaleY: transform.scaleY * factorY,
  };
}

function scaleTransformInFrame(
  transform: Transform,
  frameAnchor: Vec2,
  factorX: number,
  factorY: number,
  frameRotationDeg: number,
): Transform {
  const originInFrame = rotatePoint(transform, { x: 0, y: 0 }, -frameRotationDeg);
  const scaledInFrame = {
    x: frameAnchor.x + (originInFrame.x - frameAnchor.x) * factorX,
    y: frameAnchor.y + (originInFrame.y - frameAnchor.y) * factorY,
  };
  const originInWorld = rotatePoint(scaledInFrame, { x: 0, y: 0 }, frameRotationDeg);
  return {
    ...transform,
    x: originInWorld.x,
    y: originInWorld.y,
    scaleX: transform.scaleX * factorX,
    scaleY: transform.scaleY * factorY,
  };
}

function combinedBBoxInFrame(
  objects: ReadonlyArray<SceneObject>,
  frameRotationDeg: number,
): AABB | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const object of objects) {
    const corners = [
      { x: object.bounds.minX, y: object.bounds.minY },
      { x: object.bounds.maxX, y: object.bounds.minY },
      { x: object.bounds.maxX, y: object.bounds.maxY },
      { x: object.bounds.minX, y: object.bounds.maxY },
    ];
    for (const corner of corners) {
      const world = applyTransform(corner, object.transform);
      const framed = rotatePoint(world, { x: 0, y: 0 }, -frameRotationDeg);
      minX = Math.min(minX, framed.x);
      minY = Math.min(minY, framed.y);
      maxX = Math.max(maxX, framed.x);
      maxY = Math.max(maxY, framed.y);
      any = true;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

function rotatePoint(point: Vec2, anchor: Vec2, deltaDeg: number): Vec2 {
  const rad = (deltaDeg * Math.PI) / HALF_TURN_DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  return {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
  };
}

function flipTransformAboutPoint(
  object: SceneObject,
  axis: SelectionFlipAxis,
  anchor: Vec2,
): Transform {
  const center = objectLocalCenter(object);
  const before = applyTransform(center, object.transform);
  const target =
    axis === 'horizontal'
      ? { x: anchor.x * 2 - before.x, y: before.y }
      : { x: before.x, y: anchor.y * 2 - before.y };
  const flipped: Transform = {
    ...object.transform,
    mirrorX: axis === 'horizontal' ? !object.transform.mirrorX : object.transform.mirrorX,
    mirrorY: axis === 'vertical' ? !object.transform.mirrorY : object.transform.mirrorY,
  };
  const after = applyTransform(center, flipped);
  return {
    ...flipped,
    x: flipped.x + target.x - after.x,
    y: flipped.y + target.y - after.y,
  };
}

function objectLocalCenter(object: SceneObject): Vec2 {
  return {
    x: (object.bounds.minX + object.bounds.maxX) / 2,
    y: (object.bounds.minY + object.bounds.maxY) / 2,
  };
}

function hasRotatedObject(objects: ReadonlyArray<SceneObject>): boolean {
  return objects.some((object) => !isAxisAlignedRotation(object.transform.rotationDeg));
}

function isAxisAlignedRotation(rotationDeg: number): boolean {
  const folded = Math.abs(normalizeDeg(rotationDeg) % HALF_TURN_DEG);
  return folded <= ROTATION_EPSILON_DEG || Math.abs(folded - HALF_TURN_DEG) <= ROTATION_EPSILON_DEG;
}

function isUniformScale(factors: { readonly x: number; readonly y: number }): boolean {
  return Math.abs(factors.x - factors.y) <= MIN_DIMENSION_MM;
}

function isOptionalFiniteNumber(value: number | undefined): boolean {
  return value === undefined || Number.isFinite(value);
}

function normalizeDeg(deg: number): number {
  const normalized = deg % FULL_TURN_DEG;
  return normalized < 0 ? normalized + FULL_TURN_DEG : normalized;
}
