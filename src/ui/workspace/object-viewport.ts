import {
  curveSubpathBounds,
  transformedBounds,
  type Bounds,
  type ColoredPath,
  type SceneObject,
} from '../../core/scene';
import type { ViewTransform } from './view-transform';

// Current vector painters use <=1.5px strokes with the default miter limit,
// no shadows, and path geometry for text. Eight pixels covers that fringe.
// Selection handles and labels are drawn independently and are never culled.
const PAINT_MARGIN_PX = 8;
const pathBoundsCache = new WeakMap<ReadonlyArray<ColoredPath>, Bounds | null>();
type CanvasExtent = { readonly width: number; readonly height: number };

/** Reject only artwork proved outside the canvas, including its stroke fringe. */
export function objectIntersectsCanvas(
  object: SceneObject,
  view: ViewTransform,
  canvas: CanvasExtent | undefined,
): boolean {
  // Relief failure text can extend beyond its bitmap rectangle. Its painter
  // keeps ownership of those diagnostics rather than hiding a visible label.
  if (object.kind === 'relief') return true;
  if (!usableViewport(canvas, view)) return true;
  const bounds = 'paths' in object ? vectorBounds(object.paths) : object.bounds;
  if (bounds === null) return true;
  const transformed = transformedBounds(bounds, object.transform);
  const minX = view.offsetX + transformed.minX * view.scale;
  const minY = view.offsetY + transformed.minY * view.scale;
  const maxX = view.offsetX + transformed.maxX * view.scale;
  const maxY = view.offsetY + transformed.maxY * view.scale;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return true;
  return !(
    maxX < -PAINT_MARGIN_PX ||
    maxY < -PAINT_MARGIN_PX ||
    minX > canvas.width + PAINT_MARGIN_PX ||
    minY > canvas.height + PAINT_MARGIN_PX
  );
}

function usableViewport(
  canvas: CanvasExtent | undefined,
  view: ViewTransform,
): canvas is CanvasExtent {
  return (
    canvas !== undefined &&
    Number.isFinite(canvas.width) &&
    Number.isFinite(canvas.height) &&
    canvas.width > 0 &&
    canvas.height > 0 &&
    Number.isFinite(view.scale) &&
    view.scale > 0
  );
}

function vectorBounds(paths: ReadonlyArray<ColoredPath>): Bounds | null {
  const cached = pathBoundsCache.get(paths);
  if (cached !== undefined) return cached;
  // Stored import bounds can be stale. Derive a conservative union from the
  // actual immutable paths, including native curves rather than just their
  // coarse import polylines. Translation/rotation reuse this local-space cache.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      for (const point of polyline.points) include(point.x, point.y);
    }
    for (const curve of path.curves ?? []) {
      const bounds = curveSubpathBounds(curve);
      include(bounds.minX, bounds.minY);
      include(bounds.maxX, bounds.maxY);
    }
  }
  const bounds =
    [minX, minY, maxX, maxY].every(Number.isFinite) && minX <= maxX && minY <= maxY
      ? { minX, minY, maxX, maxY }
      : null;
  pathBoundsCache.set(paths, bounds);
  return bounds;

  function include(x: number, y: number): void {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
}
