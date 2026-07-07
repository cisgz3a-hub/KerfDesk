// Scale handles for a MULTI-object selection (audit C5). Single-object handles
// live on the object's rotated local bounds (handles.ts); a selection's
// handles live on the axis-aligned combined bounding box, and dragging one
// scales every selected object together around the opposite corner/edge. The
// actual group scaling reuses the core buildSelectionTransformEdit({resize})
// that the numeric-edits bar already drives, so handle-drag and numeric resize
// stay identical.

import type { AABB, SelectionAnchor, SelectionTransformEdit, Vec2 } from '../../core/scene';
import { HANDLE_SCREEN_PX, type HandleKind } from './handles';

const MIN_SELECTION_DIMENSION_MM = 0.001;

export type SelectionHandle = {
  readonly kind: HandleKind;
  readonly position: Vec2;
};

// The 8 scale handles (4 corners + 4 edge midpoints) on the combined box.
export function aabbHandlePoints(bbox: AABB): ReadonlyArray<SelectionHandle> {
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

// Hit-test a scene point against the combined-box handles. Handles are sized in
// screen pixels (via pxToMm) so they stay grabbable at any zoom.
export function hitAabbHandle(bbox: AABB, point: Vec2, pxToMm: number): HandleKind | null {
  const halfMm = (HANDLE_SCREEN_PX / 2) * pxToMm;
  for (const handle of aabbHandlePoints(bbox)) {
    if (
      Math.abs(point.x - handle.position.x) <= halfMm &&
      Math.abs(point.y - handle.position.y) <= halfMm
    ) {
      return handle.kind;
    }
  }
  return null;
}

// Per-handle resize spec: the pinned pivot (opposite corner/edge) and which
// side each axis grows from (undefined = that axis is not resized).
type HandleResizeSpec = {
  readonly anchor: SelectionAnchor;
  readonly x?: 'east' | 'west';
  readonly y?: 'north' | 'south';
};
const HANDLE_RESIZE: Readonly<Record<HandleKind, HandleResizeSpec>> = {
  nw: { anchor: 'se', x: 'west', y: 'north' },
  n: { anchor: 's', y: 'north' },
  ne: { anchor: 'sw', x: 'east', y: 'north' },
  e: { anchor: 'w', x: 'east' },
  se: { anchor: 'nw', x: 'east', y: 'south' },
  s: { anchor: 'n', y: 'south' },
  sw: { anchor: 'ne', x: 'west', y: 'south' },
  w: { anchor: 'e', x: 'east' },
};

// Turn a handle drag into the core group-resize edit: corner handles resize
// both axes (aspect-locked unless lockAspect is false, matching single-object
// corner scaling), edge handles resize one axis; the opposite corner/edge is
// the pinned pivot. Dimensions clamp to a small positive so a drag past the
// pivot stops rather than inverting the selection.
export function selectionResizeEditFromDrag(args: {
  readonly handle: HandleKind;
  readonly bbox: AABB;
  readonly point: Vec2;
  readonly lockAspect: boolean;
}): Extract<SelectionTransformEdit, { kind: 'resize' }> {
  const { handle, bbox, point, lockAspect } = args;
  const spec = HANDLE_RESIZE[handle];
  const width = resizeExtent(spec.x, point.x, bbox.minX, bbox.maxX);
  const height = resizeExtent(spec.y, point.y, bbox.minY, bbox.maxY);
  const isCorner = spec.x !== undefined && spec.y !== undefined;
  return {
    kind: 'resize',
    anchor: spec.anchor,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    preserveAspect: isCorner ? lockAspect : false,
  };
}

// New extent along one axis: the handle grows from the far/near edge toward
// the pointer, clamped positive.
function resizeExtent(
  side: 'east' | 'west' | 'north' | 'south' | undefined,
  pointer: number,
  min: number,
  max: number,
): number | undefined {
  if (side === undefined) return undefined;
  const growsFromMin = side === 'east' || side === 'south';
  return Math.max(MIN_SELECTION_DIMENSION_MM, growsFromMin ? pointer - min : max - pointer);
}
