// Selection-handle geometry, hit-test, and scale math for F-A6.
//
// 8 scale handles: 4 corners (nw/ne/sw/se) + 4 edge midpoints (n/e/s/w).
// Corners scale both axes; edges scale only one (n/s lock X, e/w lock Y).
// Alt-modifier scales from the bbox center instead of the opposite anchor.
// Rotation handle math lives in `rotate-handle.ts`.
//
// Rotated objects fall back to their AABB for handle layout, and we
// re-anchor on the AABB corners rather than the original local bounds —
// gives a "good enough" scale UX for rotated designs without re-deriving
// the rotation-aware formula every frame.

import {
  applyTransform,
  type SceneObject,
  type Transform,
  transformedBBox,
  type Vec2,
} from '../../core/scene';

export type HandleKind = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';

export type Handle = {
  readonly kind: HandleKind;
  readonly position: Vec2; // scene coords (mm)
};

export const HANDLE_SCREEN_PX = 8;

// All 8 scale handles for the given selected object: 4 corners + 4 edge
// midpoints. The rotate handle is positioned separately by rotate-handle.ts
// and rendered alongside these in draw-scene.ts.
export function handlesFor(object: SceneObject): ReadonlyArray<Handle> {
  const bbox = transformedBBox(object);
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;
  return [
    { kind: 'nw', position: { x: bbox.minX, y: bbox.minY } },
    { kind: 'n', position: { x: midX, y: bbox.minY } },
    { kind: 'ne', position: { x: bbox.maxX, y: bbox.minY } },
    { kind: 'e', position: { x: bbox.maxX, y: midY } },
    { kind: 'se', position: { x: bbox.maxX, y: bbox.maxY } },
    { kind: 's', position: { x: midX, y: bbox.maxY } },
    { kind: 'sw', position: { x: bbox.minX, y: bbox.maxY } },
    { kind: 'w', position: { x: bbox.minX, y: midY } },
  ];
}

// Hit-test a scene point against an object's handles. `pxToMm` is the scene-
// units-per-pixel ratio at the current viewport scale — handles are sized in
// screen pixels so they stay clickable at any zoom level.
export function hitHandle(object: SceneObject, point: Vec2, pxToMm: number): HandleKind | null {
  const halfMm = (HANDLE_SCREEN_PX / 2) * pxToMm;
  for (const handle of handlesFor(object)) {
    if (
      Math.abs(point.x - handle.position.x) <= halfMm &&
      Math.abs(point.y - handle.position.y) <= halfMm
    ) {
      return handle.kind;
    }
  }
  return null;
}

// Returns the scene-coords point that should stay anchored while dragging.
// When `fromCenter` is true (alt-drag) the anchor is the bbox center —
// scaling pulls both halves outward / inward symmetrically. For edge
// handles, the anchor mirrors the axis we're not scaling.
function anchorPoint(object: SceneObject, dragging: HandleKind, fromCenter: boolean): Vec2 {
  const bbox = transformedBBox(object);
  if (fromCenter) {
    return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
  }
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;
  switch (dragging) {
    case 'nw':
      return { x: bbox.maxX, y: bbox.maxY };
    case 'ne':
      return { x: bbox.minX, y: bbox.maxY };
    case 'sw':
      return { x: bbox.maxX, y: bbox.minY };
    case 'se':
      return { x: bbox.minX, y: bbox.minY };
    case 'n':
      return { x: midX, y: bbox.maxY };
    case 's':
      return { x: midX, y: bbox.minY };
    case 'e':
      return { x: bbox.minX, y: midY };
    case 'w':
      return { x: bbox.maxX, y: midY };
  }
}

// Build a new transform that keeps the anchor pinned in scene coords while
// the dragged handle follows `dragTo`. Modifiers:
//   * lockAspect (shift)   — shrinks the smaller axis to match the larger.
//   * fromCenter (alt/opt) — anchor is the bbox center, not the opposite edge.
// Edge handles ('n'/'s'/'e'/'w') constrain factorY or factorX to 1.
export function scaleObjectByHandleDrag(args: {
  readonly object: SceneObject;
  readonly handle: HandleKind;
  readonly dragTo: Vec2;
  readonly lockAspect: boolean;
  readonly fromCenter?: boolean;
}): Transform {
  const { object, handle, dragTo, lockAspect, fromCenter = false } = args;
  const t = object.transform;
  const anchor = anchorPoint(object, handle, fromCenter);
  const oldCorner = handlePositionForKind(object, handle);
  const { factorX, factorY } = computeScaleFactors({
    handle,
    anchor,
    oldCorner,
    dragTo,
    lockAspect,
  });

  const newScaleX = t.scaleX * factorX;
  const newScaleY = t.scaleY * factorY;

  // Anchor's local coords (inside applyTransform's pre-translate frame) stay
  // the same; only the translate adjusts so the post-scale point lands at
  // the same scene location.
  const anchorLocal = inverseToLocal(anchor, t);
  return {
    ...t,
    scaleX: newScaleX,
    scaleY: newScaleY,
    x: anchor.x - newScaleX * (anchorLocal.x * (t.mirrorX ? -1 : 1)),
    y: anchor.y - newScaleY * (anchorLocal.y * (t.mirrorY ? -1 : 1)),
  };
}

const MIN_SCALE_FACTOR = 0.001;

// Extracted from scaleObjectByHandleDrag to keep that function under the
// cyclomatic-complexity cap. Pure: scene math only, no transform state.
function computeScaleFactors(args: {
  readonly handle: HandleKind;
  readonly anchor: Vec2;
  readonly oldCorner: Vec2;
  readonly dragTo: Vec2;
  readonly lockAspect: boolean;
}): { readonly factorX: number; readonly factorY: number } {
  const { handle, anchor, oldCorner, dragTo, lockAspect } = args;
  const denomX = oldCorner.x - anchor.x;
  const denomY = oldCorner.y - anchor.y;
  let factorX = denomX === 0 ? 1 : (dragTo.x - anchor.x) / denomX;
  let factorY = denomY === 0 ? 1 : (dragTo.y - anchor.y) / denomY;
  ({ factorX, factorY } = constrainByEdgeKind(handle, factorX, factorY));
  if (lockAspect && !isEdgeHandle(handle)) {
    ({ factorX, factorY } = applyLockAspect(factorX, factorY));
  }
  return {
    factorX: clampAwayFromZero(factorX),
    factorY: clampAwayFromZero(factorY),
  };
}

function constrainByEdgeKind(
  handle: HandleKind,
  factorX: number,
  factorY: number,
): { factorX: number; factorY: number } {
  if (handle === 'n' || handle === 's') return { factorX: 1, factorY };
  if (handle === 'e' || handle === 'w') return { factorX, factorY: 1 };
  return { factorX, factorY };
}

function applyLockAspect(factorX: number, factorY: number): { factorX: number; factorY: number } {
  const u = Math.min(Math.abs(factorX), Math.abs(factorY));
  return {
    factorX: Math.sign(factorX || 1) * u,
    factorY: Math.sign(factorY || 1) * u,
  };
}

function clampAwayFromZero(n: number): number {
  return Math.abs(n) < MIN_SCALE_FACTOR ? MIN_SCALE_FACTOR : n;
}

function isEdgeHandle(h: HandleKind): boolean {
  return h === 'n' || h === 's' || h === 'e' || h === 'w';
}

function handlePositionForKind(object: SceneObject, kind: HandleKind): Vec2 {
  for (const h of handlesFor(object)) if (h.kind === kind) return h.position;
  return { x: 0, y: 0 };
}

// Inverse of applyTransform's scale+mirror step for a single point.
// We use this to learn the local coords of the anchor under the OLD transform,
// then re-apply the NEW transform with translate-compensation.
function inverseToLocal(scenePoint: Vec2, t: Transform): Vec2 {
  // Inverse-translate, then inverse-rotate, then inverse-mirror+scale.
  const u = { x: scenePoint.x - t.x, y: scenePoint.y - t.y };
  const rad = (-t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = u.x * cos - u.y * sin;
  const yr = u.x * sin + u.y * cos;
  const xm = t.mirrorX ? -xr : xr;
  const ym = t.mirrorY ? -yr : yr;
  return { x: xm / (t.scaleX || 1), y: ym / (t.scaleY || 1) };
}

// Round-trip helper for tests: maps an object-local point through transform.
export function applyForwardLocal(t: Transform, local: Vec2): Vec2 {
  return applyTransform(local, t);
}
