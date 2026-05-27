// Rotation handle (F-A6) — sits at a fixed scene-mm offset above the
// selected object's bbox. Dragging it rotates the object around its
// bbox center; Shift snaps to 15° increments.
//
// Math note: applyTransform rotates around the object's local origin (not
// the bbox center), so to rotate around the *visual* center while keeping
// it pinned, we recompute the bbox center under the new transform and
// shift x/y by the delta. The result feels right to the user: the design
// pivots in place, just like LightBurn / xTool.

import { type SceneObject, type Transform, transformedBBox, type Vec2 } from '../../core/scene';

// Distance above the bbox at which the rotation handle sits, in scene mm.
// Tuned so the handle stays visually separated from the corner handles at
// the default fit-to-bed scale.
export const ROTATE_HANDLE_OFFSET_MM = 24;
export const ROTATE_SNAP_DEG = 15;

export function rotateHandlePosition(object: SceneObject): Vec2 {
  const bbox = transformedBBox(object);
  const midX = (bbox.minX + bbox.maxX) / 2;
  return { x: midX, y: bbox.minY - ROTATE_HANDLE_OFFSET_MM };
}

export function hitRotateHandle(object: SceneObject, point: Vec2, pxToMm: number): boolean {
  const pos = rotateHandlePosition(object);
  // Slightly larger pick radius than the square scale handles since the
  // rotate handle is round and visually smaller.
  const halfMm = 6 * pxToMm;
  return Math.abs(point.x - pos.x) <= halfMm && Math.abs(point.y - pos.y) <= halfMm;
}

// Rotate `object` so that the rotate-handle points toward `dragTo`, keeping
// the bbox center pinned. `snap` (Shift) quantizes to ROTATE_SNAP_DEG.
export function rotateObjectByDrag(args: {
  readonly object: SceneObject;
  readonly dragTo: Vec2;
  readonly snap: boolean;
}): Transform {
  const { object, dragTo, snap } = args;
  const center = bboxCenter(object);
  // Angle from center to current dragTo. Add 90° because the handle's
  // canonical position is directly ABOVE the center (negative Y) — we want
  // 0° to mean "pointing up".
  const dx = dragTo.x - center.x;
  const dy = dragTo.y - center.y;
  const targetRad = Math.atan2(dy, dx) + Math.PI / 2;
  let targetDeg = (targetRad * 180) / Math.PI;
  if (snap) targetDeg = Math.round(targetDeg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;

  // Apply the new rotation and re-pin the bbox center.
  const provisional: Transform = { ...object.transform, rotationDeg: targetDeg };
  const newCenter = bboxCenter({ ...object, transform: provisional });
  return {
    ...provisional,
    x: provisional.x + (center.x - newCenter.x),
    y: provisional.y + (center.y - newCenter.y),
  };
}

function bboxCenter(object: SceneObject): Vec2 {
  const b = transformedBBox(object);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
