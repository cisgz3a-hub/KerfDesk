// The outlines the before/after thumbnail of Optimize Shapes and Combine Shapes
// draws (perf audit S6-P3-3). The thumbnail is a few hundred pixels across,
// so each outline is drawn to a thousandth of the selection's span: a point
// closer than that to the last one drawn adds nothing the eye can see. Points
// are thinned in the object's own space and only the kept ones are placed,
// so 2,000 traced outlines no longer build 400,000 points on the UI thread
// as the dialog opens. Display only: the job and the committed geometry are
// untouched.

import type { VectorSceneObject } from '../../core/geometry';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurvesForTransform,
} from '../../core/scene/curve-path';
import { applyTransform } from '../../core/scene/transform';
import type { Polyline, Transform, Vec2 } from '../../core/scene';
import { roundToThousandth } from '../../core/util/rounding';

/** Steps across the selection's longer side. */
const OUTLINE_STEPS = 1000;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

export type ComparisonOutline = { readonly d: string; readonly bounds: Box | null };

export function comparisonOutline(objects: ReadonlyArray<VectorSceneObject>): ComparisonOutline {
  const step = outlineStep(objects);
  const parts: string[] = [];
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const object of objects) {
    const { transform } = object;
    const largestScale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
    const localStep = largestScale > 0 && Number.isFinite(largestScale) ? step / largestScale : 0;
    for (const path of object.paths) {
      const flattened = flattenColoredPathCurvesForTransform(path, transform, {
        toleranceMm: Math.max(DEFAULT_MACHINE_CURVE_TOLERANCE_MM, step),
        segmentBudget: Number.MAX_SAFE_INTEGER,
      });
      if (flattened.kind !== 'ok') continue;
      for (const polyline of flattened.polylines) {
        drawPolyline(polyline, transform, localStep, parts, box);
      }
    }
  }
  return { d: parts.join(''), bounds: box.minX <= box.maxX ? box : null };
}

// Points closer than `localStep` (object space) to the last one drawn are
// skipped, except a polyline's last point.
function drawPolyline(
  polyline: Polyline,
  transform: Transform,
  localStep: number,
  parts: string[],
  box: Box,
): void {
  const { points } = polyline;
  let drawn: Vec2 | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const far = drawn === null || Math.hypot(point.x - drawn.x, point.y - drawn.y) >= localStep;
    if (!far && index !== points.length - 1) continue;
    const world = applyTransform(point, transform);
    parts.push(
      `${drawn === null ? 'M' : 'L'}${roundToThousandth(world.x)} ${roundToThousandth(world.y)}`,
    );
    drawn = point;
    box.minX = Math.min(box.minX, world.x);
    box.minY = Math.min(box.minY, world.y);
    box.maxX = Math.max(box.maxX, world.x);
    box.maxY = Math.max(box.maxY, world.y);
  }
  if (drawn !== null && polyline.closed) parts.push('Z');
}

// A thousandth of the longer side of the selection's box, taken from each
// object's own box placed on the canvas (an upper bound for a turned one).
function outlineStep(objects: ReadonlyArray<VectorSceneObject>): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = object.bounds;
    for (const corner of [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]) {
      const placed = applyTransform(corner, object.transform);
      minX = Math.min(minX, placed.x);
      minY = Math.min(minY, placed.y);
      maxX = Math.max(maxX, placed.x);
      maxY = Math.max(maxY, placed.y);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  return Number.isFinite(span) && span > 0 ? span / OUTLINE_STEPS : 0;
}
