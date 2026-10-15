// Calculates an exact-clearance placement without changing the scene or machine.
import { applyTransform } from './transform';
import { transformedBBox, transformedBounds } from './hit-test';
import type { SceneObject, ShapeObject } from './scene-object';
import { isCanonicalEllipse } from './canonical-ellipse';

export type BoardFitOptions = {
  readonly marginMm: number;
  readonly mode: 'fit' | 'keep-size';
};

export type BoardFitPlan =
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ok';
      readonly object: SceneObject;
      readonly scale: number;
      readonly fits: boolean;
    };

export function fitObjectToBoard(
  object: SceneObject,
  board: ShapeObject,
  options: BoardFitOptions,
): BoardFitPlan {
  if (!Number.isFinite(options.marginMm) || options.marginMm < 0) {
    return { kind: 'error', message: 'Enter an edge margin of zero or more millimetres.' };
  }
  const region = transformedBBox(board);
  const size = boardSize(board);
  const width = size.width - 2 * options.marginMm;
  const height = size.height - 2 * options.marginMm;
  // Keep-size is a placement operation: report exhausted clearance as an overrun.
  if (options.mode === 'fit' && (width <= 0 || height <= 0)) {
    return { kind: 'error', message: 'The edge margin leaves no room for artwork.' };
  }
  const footprint = transformedBounds(object.bounds, { ...object.transform, x: 0, y: 0 });
  const objectWidth = footprint.maxX - footprint.minX;
  const objectHeight = footprint.maxY - footprint.minY;
  if (!(objectWidth > 0) || !(objectHeight > 0)) {
    return { kind: 'error', message: 'The selected artwork needs a measurable width and height.' };
  }
  // Captured round boards and circular jig outlines are circles. For an ellipse
  // use its smaller inscribed circle; never promise containment in its AABB.
  const availableScale =
    board.spec.kind === 'ellipse'
      ? Math.min(width, height) / (2 * radiusAboutCenter(object))
      : Math.min(width / objectWidth, height / objectHeight);
  const scale = options.mode === 'keep-size' ? 1 : availableScale;
  if (!Number.isFinite(scale) || scale <= 0) {
    return { kind: 'error', message: 'The artwork cannot be fitted at these dimensions.' };
  }
  const transform = {
    ...object.transform,
    x: 0,
    y: 0,
    scaleX: object.transform.scaleX * scale,
    scaleY: object.transform.scaleY * scale,
  };
  const center = applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    transform,
  );
  return {
    kind: 'ok',
    object: {
      ...object,
      transform: {
        ...transform,
        x: (region.minX + region.maxX) / 2 - center.x,
        y: (region.minY + region.maxY) / 2 - center.y,
      },
    },
    scale,
    fits: availableScale >= 1 || options.mode === 'fit',
  };
}

function boardSize(board: ShapeObject): { readonly width: number; readonly height: number } {
  if (board.spec.kind === 'ellipse') {
    const diameter = Math.min(
      Math.abs((board.bounds.maxX - board.bounds.minX) * board.transform.scaleX),
      Math.abs((board.bounds.maxY - board.bounds.minY) * board.transform.scaleY),
    );
    return { width: diameter, height: diameter };
  }
  const bounds = transformedBBox(board);
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

function radiusAboutCenter(object: SceneObject): number {
  const halfWidth =
    Math.abs((object.bounds.maxX - object.bounds.minX) * object.transform.scaleX) / 2;
  const halfHeight =
    Math.abs((object.bounds.maxY - object.bounds.minY) * object.transform.scaleY) / 2;
  // A parametric ellipse reaches its major radius; other objects use the
  // enclosing local rectangle, including every corner after rotation/mirroring.
  return isCanonicalEllipse(object)
    ? Math.max(halfWidth, halfHeight)
    : Math.hypot(halfWidth, halfHeight);
}

/** Actual ellipse extents; other artwork retains its conservative scene bounds. */
export function fittedArtworkSize(object: SceneObject): { width: number; height: number } {
  if (!isCanonicalEllipse(object)) {
    const bounds = transformedBBox(object);
    return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
  }
  const width = (object.bounds.maxX - object.bounds.minX) * object.transform.scaleX;
  const height = (object.bounds.maxY - object.bounds.minY) * object.transform.scaleY;
  const angle = (object.transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    width: Math.hypot(width * cos, height * sin),
    height: Math.hypot(width * sin, height * cos),
  };
}
