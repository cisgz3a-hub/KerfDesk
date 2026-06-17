// Rotation handle (F-A6) — sits at a fixed scene-mm offset above the
// selected object's bbox. Dragging it rotates the object around its
// bbox center; Shift snaps to 15° increments.
//
// Math note: applyTransform rotates around the object's local origin (not
// the bbox center), so to rotate around the *visual* center while keeping
// it pinned, we recompute the bbox center under the new transform and
// shift x/y by the delta. The result feels right to the user: the design
// pivots in place, just like LightBurn / xTool.

import {
  type SceneObject,
  type SelectionAnchor,
  type Transform,
  transformedBBox,
  type Vec2,
} from '../../core/scene';

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
  readonly anchor?: SelectionAnchor;
}): Transform {
  const { object, dragTo, snap, anchor = 'c' } = args;
  const center = anchorPoint(object, anchor);
  // Angle from center to current dragTo. Add 90° because the handle's
  // canonical position is directly ABOVE the center (negative Y) — we want
  // 0° to mean "pointing up".
  const dx = dragTo.x - center.x;
  const dy = dragTo.y - center.y;
  const targetRad = Math.atan2(dy, dx) + Math.PI / 2;
  let targetDeg = (targetRad * 180) / Math.PI;
  if (snap) targetDeg = Math.round(targetDeg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;

  const deltaDeg = targetDeg - object.transform.rotationDeg;
  const origin = rotatePoint({ x: object.transform.x, y: object.transform.y }, center, deltaDeg);
  return {
    ...object.transform,
    x: origin.x,
    y: origin.y,
    rotationDeg: targetDeg,
  };
}

function bboxCenter(object: SceneObject): Vec2 {
  const b = transformedBBox(object);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function anchorPoint(object: SceneObject, anchor: SelectionAnchor): Vec2 {
  if (anchor === 'c') return bboxCenter(object);
  const b = transformedBBox(object);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const x = anchor.endsWith('w') ? b.minX : anchor.endsWith('e') ? b.maxX : midX;
  const y = anchor.startsWith('n') ? b.minY : anchor.startsWith('s') ? b.maxY : midY;
  return { x, y };
}

function rotatePoint(point: Vec2, anchor: Vec2, deltaDeg: number): Vec2 {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  return {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
  };
}
