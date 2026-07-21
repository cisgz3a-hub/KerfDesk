// Free-transform interaction math (ADR-242 PP-D, Top-20 item 11): the
// Photoshop Ctrl+T grammar — corner/edge handles scale about the centre,
// dragging outside rotates, inside moves; Shift toggles uniform scaling
// (post-CC2019: proportional is the default), Enter commits, Esc cancels.
// Pure functions over the affine so every rule is unit-testable.

import type { AffineTransform, PixelRect } from '../../core/image-edit';

export type TransformHandle = 'move' | 'rotate' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLE_HIT_RADIUS_PX = 7;

/** The transformed box centre in document space. */
export function transformCentre(
  rect: PixelRect,
  affine: AffineTransform,
): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2 + affine.translateX,
    y: rect.y + rect.height / 2 + affine.translateY,
  };
}

/** The 8 handle positions + box corners in DOCUMENT space. */
export function handlePositions(
  rect: PixelRect,
  affine: AffineTransform,
): Readonly<Record<Exclude<TransformHandle, 'move' | 'rotate'>, { x: number; y: number }>> {
  const c = transformCentre(rect, affine);
  const hw = (rect.width / 2) * affine.scaleX;
  const hh = (rect.height / 2) * affine.scaleY;
  const rad = (affine.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (lx: number, ly: number): { x: number; y: number } => ({
    x: c.x + lx * cos - ly * sin,
    y: c.y + lx * sin + ly * cos,
  });
  return {
    nw: at(-hw, -hh),
    n: at(0, -hh),
    ne: at(hw, -hh),
    e: at(hw, 0),
    se: at(hw, hh),
    s: at(0, hh),
    sw: at(-hw, hh),
    w: at(-hw, 0),
  };
}

/** Which handle a document-space point grabs (screen-scaled tolerance). */
export function hitTransformHandle(
  rect: PixelRect,
  affine: AffineTransform,
  point: { x: number; y: number },
  viewScale: number,
): TransformHandle {
  const tolerance = HANDLE_HIT_RADIUS_PX / viewScale;
  const handles = handlePositions(rect, affine);
  for (const [name, pos] of Object.entries(handles)) {
    if (Math.hypot(point.x - pos.x, point.y - pos.y) <= tolerance) {
      return name as TransformHandle;
    }
  }
  // Inside the (rotated) box = move; outside = rotate.
  const c = transformCentre(rect, affine);
  const rad = (-affine.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const inside =
    Math.abs(lx) <= Math.abs((rect.width / 2) * affine.scaleX) &&
    Math.abs(ly) <= Math.abs((rect.height / 2) * affine.scaleY);
  return inside ? 'move' : 'rotate';
}

/** Advance the affine for a drag from `fromPoint` to `toPoint`. */
export function dragTransform(
  start: AffineTransform,
  rect: PixelRect,
  handle: TransformHandle,
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number },
  uniformReleased: boolean,
): AffineTransform {
  const c = transformCentre(rect, start);
  if (handle === 'move') {
    return {
      ...start,
      translateX: start.translateX + toPoint.x - fromPoint.x,
      translateY: start.translateY + toPoint.y - fromPoint.y,
    };
  }
  if (handle === 'rotate') {
    const a0 = Math.atan2(fromPoint.y - c.y, fromPoint.x - c.x);
    const a1 = Math.atan2(toPoint.y - c.y, toPoint.x - c.x);
    return { ...start, rotateDeg: start.rotateDeg + ((a1 - a0) * 180) / Math.PI };
  }
  return dragScale(start, handle, c, fromPoint, toPoint, uniformReleased);
}

function dragScale(
  start: AffineTransform,
  handle: TransformHandle,
  c: { x: number; y: number },
  fromPoint: { x: number; y: number },
  toPoint: { x: number; y: number },
  uniformReleased: boolean,
): AffineTransform {
  // Work in the box's local (unrotated) frame.
  const rad = (-start.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos,
  });
  const l0 = local(fromPoint);
  const l1 = local(toPoint);
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');
  const ratioX = affectsX && Math.abs(l0.x) > 1e-3 ? l1.x / l0.x : 1;
  const ratioY = affectsY && Math.abs(l0.y) > 1e-3 ? l1.y / l0.y : 1;
  const corner = affectsX && affectsY;
  // Proportional by default on corners; Shift releases the constraint.
  if (corner && !uniformReleased) {
    const uniform = Math.abs(ratioX) > Math.abs(ratioY) ? ratioX : ratioY;
    return { ...start, scaleX: start.scaleX * uniform, scaleY: start.scaleY * uniform };
  }
  return { ...start, scaleX: start.scaleX * ratioX, scaleY: start.scaleY * ratioY };
}
