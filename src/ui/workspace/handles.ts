// Selection-handle geometry, hit-test, and scale math for F-A6.
//
// 8 scale handles: 4 corners (nw/ne/sw/se) + 4 edge midpoints (n/e/s/w).
// Corners scale both axes; edges scale only one (n/s lock X, e/w lock Y).
// Ctrl/Cmd scales from the bbox center instead of the opposite anchor. The key
// mapping lives in drag-state; this module only receives the resolved flag.
// Rotation handle math lives in `rotate-handle.ts`.
//
// Handles live on the object's transformed local bounds, not on an
// axis-aligned bbox. That keeps resize behavior stable after rotation.

import {
  applyTransform,
  type SceneObject,
  type SelectionAnchor,
  type Transform,
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
  return [
    handleFor(object, 'nw'),
    handleFor(object, 'n'),
    handleFor(object, 'ne'),
    handleFor(object, 'e'),
    handleFor(object, 'se'),
    handleFor(object, 's'),
    handleFor(object, 'sw'),
    handleFor(object, 'w'),
  ];
}

export function selectionFrameFor(object: SceneObject): ReadonlyArray<Vec2> {
  return [
    localPointForHandle(object, 'nw'),
    localPointForHandle(object, 'ne'),
    localPointForHandle(object, 'se'),
    localPointForHandle(object, 'sw'),
  ].map((point) => applyTransform(point, object.transform));
}

function handleFor(object: SceneObject, kind: HandleKind): Handle {
  return { kind, position: applyTransform(localPointForHandle(object, kind), object.transform) };
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
function anchorLocalPoint(
  object: SceneObject,
  dragging: HandleKind,
  fromCenter: boolean,
  anchor?: SelectionAnchor,
): Vec2 {
  const { minX, minY, maxX, maxY } = object.bounds;
  if (fromCenter) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const selected = selectedAnchorLocalPoint(object, dragging, anchor);
  if (selected !== null) return selected;
  return oppositeLocalPointForHandle(object, dragging);
}

function selectedAnchorLocalPoint(
  object: SceneObject,
  dragging: HandleKind,
  anchor?: SelectionAnchor,
): Vec2 | null {
  if (anchor === undefined) return null;
  const selected = localPointForAnchor(object, anchor);
  const handle = localPointForHandle(object, dragging);
  return selectedAnchorCanResizeHandle(dragging, selected, handle) ? selected : null;
}

function selectedAnchorCanResizeHandle(
  dragging: HandleKind,
  selected: Vec2,
  handle: Vec2,
): boolean {
  if (dragging === 'e' || dragging === 'w') return selected.x !== handle.x;
  if (dragging === 'n' || dragging === 's') return selected.y !== handle.y;
  return selected.x !== handle.x && selected.y !== handle.y;
}

function oppositeLocalPointForHandle(object: SceneObject, dragging: HandleKind): Vec2 {
  const { minX, minY, maxX, maxY } = object.bounds;
  switch (dragging) {
    case 'nw':
      return { x: maxX, y: maxY };
    case 'ne':
      return { x: minX, y: maxY };
    case 'sw':
      return { x: maxX, y: minY };
    case 'se':
      return { x: minX, y: minY };
    case 'n':
      return { x: (minX + maxX) / 2, y: maxY };
    case 's':
      return { x: (minX + maxX) / 2, y: minY };
    case 'e':
      return { x: minX, y: (minY + maxY) / 2 };
    case 'w':
      return { x: maxX, y: (minY + maxY) / 2 };
  }
}

// Build a new transform that keeps the anchor pinned in scene coords while
// the dragged handle follows `dragTo`. Modifiers:
//   * lockAspect   — shrinks the smaller axis to match the larger.
//   * fromCenter   — anchor is the bbox center, not the opposite edge.
// Edge handles ('n'/'s'/'e'/'w') constrain factorY or factorX to 1.
export function scaleObjectByHandleDrag(args: {
  readonly object: SceneObject;
  readonly handle: HandleKind;
  readonly dragTo: Vec2;
  readonly lockAspect: boolean;
  readonly fromCenter?: boolean;
  readonly anchor?: SelectionAnchor;
}): Transform {
  const { object, handle, dragTo, lockAspect, fromCenter = false, anchor: selectionAnchor } = args;
  const t = object.transform;
  const anchorLocal = anchorLocalPoint(object, handle, fromCenter, selectionAnchor);
  const handleLocal = localPointForHandle(object, handle);
  const anchor = applyTransform(anchorLocal, t);
  const { factorX, factorY } = computeScaleFactors({
    handle,
    transform: t,
    anchorLocal,
    handleLocal,
    anchorScene: anchor,
    dragTo,
    lockAspect,
  });

  const newScaleX = t.scaleX * factorX;
  const newScaleY = t.scaleY * factorY;

  // Anchor's local coords (inside applyTransform's pre-translate frame) stay
  // the same; only the translate adjusts so the post-scale, post-rotation
  // point lands at the same scene location.
  const anchorOffset = applyTransform(anchorLocal, {
    ...t,
    x: 0,
    y: 0,
    scaleX: newScaleX,
    scaleY: newScaleY,
  });
  return {
    ...t,
    scaleX: newScaleX,
    scaleY: newScaleY,
    x: anchor.x - anchorOffset.x,
    y: anchor.y - anchorOffset.y,
  };
}

const MIN_SCALE_FACTOR = 0.001;

// Extracted from scaleObjectByHandleDrag to keep that function under the
// cyclomatic-complexity cap. Pure: scene math only, no transform state.
function computeScaleFactors(args: {
  readonly handle: HandleKind;
  readonly transform: Transform;
  readonly anchorLocal: Vec2;
  readonly handleLocal: Vec2;
  readonly anchorScene: Vec2;
  readonly dragTo: Vec2;
  readonly lockAspect: boolean;
}): { readonly factorX: number; readonly factorY: number } {
  const { handle, transform, anchorLocal, handleLocal, anchorScene, dragTo, lockAspect } = args;
  const localDelta = {
    x: handleLocal.x - anchorLocal.x,
    y: handleLocal.y - anchorLocal.y,
  };
  const dragLocal = inverseVectorToLocalScaleFrame(
    { x: dragTo.x - anchorScene.x, y: dragTo.y - anchorScene.y },
    transform,
  );
  let factorX = localDelta.x === 0 ? 1 : dragLocal.x / localDelta.x / transform.scaleX;
  let factorY = localDelta.y === 0 ? 1 : dragLocal.y / localDelta.y / transform.scaleY;
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

function localPointForHandle(object: SceneObject, kind: HandleKind): Vec2 {
  const { minX, minY, maxX, maxY } = object.bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  switch (kind) {
    case 'nw':
      return { x: minX, y: minY };
    case 'n':
      return { x: midX, y: minY };
    case 'ne':
      return { x: maxX, y: minY };
    case 'e':
      return { x: maxX, y: midY };
    case 'se':
      return { x: maxX, y: maxY };
    case 's':
      return { x: midX, y: maxY };
    case 'sw':
      return { x: minX, y: maxY };
    case 'w':
      return { x: minX, y: midY };
  }
}

function localPointForAnchor(object: SceneObject, anchor: SelectionAnchor): Vec2 {
  const { minX, minY, maxX, maxY } = object.bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const x = anchor.endsWith('w') ? minX : anchor.endsWith('e') ? maxX : midX;
  const y = anchor.startsWith('n') ? minY : anchor.startsWith('s') ? maxY : midY;
  return { x, y };
}

// Inverse of applyTransform's rotation+mirror steps for a vector. Translation
// is intentionally absent because this operates on a drag delta, not a point.
function inverseVectorToLocalScaleFrame(vector: Vec2, t: Transform): Vec2 {
  const rad = (-t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = vector.x * cos - vector.y * sin;
  const yr = vector.x * sin + vector.y * cos;
  const xm = t.mirrorX ? -xr : xr;
  const ym = t.mirrorY ? -yr : yr;
  return { x: xm, y: ym };
}

// Round-trip helper for tests: maps an object-local point through transform.
export function applyForwardLocal(t: Transform, local: Vec2): Vec2 {
  return applyTransform(local, t);
}
