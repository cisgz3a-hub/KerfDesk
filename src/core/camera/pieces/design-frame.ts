// The selected design as the piece fill sees it (ADR-442 amendment 1): the
// box around the design in its own frame, not the page's. When every selected
// object is turned the same way (give or take quarter turns), that turn is the
// design's frame, so artwork already turned on the canvas keeps its own long
// side and size; mixed turns fall back to the page frame. Pure core.

import { applyTransform, type SceneObject } from '../../scene';
import type { DesignFrame } from './piece-placements';
import type { Point } from './rotated-rect';

// Turns closer than this to a whole number of quarter turns apart share a frame.
const SHARED_TURN_TOLERANCE_DEG = 1e-6;

/** The design's frame, or null when nothing is selected. */
export function designFrame(objects: ReadonlyArray<SceneObject>): DesignFrame | null {
  const first = objects[0];
  if (first === undefined) return null;
  const turnDeg = objects.every((object) =>
    sameQuarterTurn(object.transform.rotationDeg, first.transform.rotationDeg),
  )
    ? first.transform.rotationDeg
    : 0;
  const rad = (turnDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const corner of objects.flatMap(boundsCornersOnPage)) {
    // The corner in the design's frame: the page turned back by `turnDeg`.
    const u = corner.x * cos + corner.y * sin;
    const v = -corner.x * sin + corner.y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    centre: { x: cu * cos - cv * sin, y: cu * sin + cv * cos },
    width: maxU - minU,
    height: maxV - minV,
    turnDeg,
  };
}

function boundsCornersOnPage(object: SceneObject): ReadonlyArray<Point> {
  const { minX, minY, maxX, maxY } = object.bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => applyTransform(corner, object.transform));
}

function sameQuarterTurn(a: number, b: number): boolean {
  const apart = (((a - b) % 90) + 90) % 90;
  return apart < SHARED_TURN_TOLERANCE_DEG || apart > 90 - SHARED_TURN_TOLERANCE_DEG;
}
