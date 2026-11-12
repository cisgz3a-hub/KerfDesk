// Scale handles for a MULTI-object selection (audit C5). Single-object handles
// live on the object's rotated local bounds (handles.ts); a selection's
// handles live on the axis-aligned combined bounding box, and dragging one
// scales every selected object together around the opposite corner/edge. The
// actual group scaling reuses the core buildSelectionTransformEdit({resize})
// that the numeric-edits bar already drives, so handle-drag and numeric resize
// stay identical.

import type { AABB, SelectionAnchor, SelectionTransformEdit, Vec2 } from '../../core/scene';
import { nearestHandleAt, offeredHandleKinds, pressBelongsToBody } from './handle-layout';
import type { HandleKind } from './handles';

const MIN_SELECTION_DIMENSION_MM = 0.001;
// The core resize's own zero-extent limit (selection-transform.ts).
const FLAT_EXTENT_MM = 0.000001;

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

/** The handles the combined box shows at this zoom: fewer when it is small (handle-layout.ts). */
export function visibleAabbHandlePoints(
  bbox: AABB,
  pxToMm: number,
): ReadonlyArray<SelectionHandle> {
  const offered = new Set(offeredHandleKinds(aabbHandleBox(bbox), pxToMm));
  return aabbHandlePoints(bbox).filter((handle) => offered.has(handle.kind));
}

function aabbHandleBox(bbox: AABB): { readonly widthMm: number; readonly heightMm: number } {
  return { widthMm: bbox.maxX - bbox.minX, heightMm: bbox.maxY - bbox.minY };
}

// Hit-test a scene point against the combined-box handles. Handles are sized in
// screen pixels (via pxToMm) so they stay grabbable at any zoom. On a small box
// a press inside it is left to the artwork, as on a single object.
export function hitAabbHandle(bbox: AABB, point: Vec2, pxToMm: number): HandleKind | null {
  const local = { x: point.x - bbox.minX, y: point.y - bbox.minY };
  if (pressBelongsToBody(aabbHandleBox(bbox), local, pxToMm)) return null;
  return nearestHandleAt(visibleAabbHandlePoints(bbox, pxToMm), point, pxToMm)?.kind ?? null;
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
  w: { anchor: 'e', x: 'west' },
};

// Turn a handle drag into the core group-resize edit: corner handles resize
// both axes (aspect-locked unless lockAspect is false, matching single-object
// corner scaling), edge handles resize one axis; the opposite corner/edge is
// the pinned pivot. Dimensions clamp to a small positive so a drag past the
// pivot stops rather than inverting the selection. An axis the selection has no
// extent on (collinear straight lines) is left alone, as a single object's
// handle leaves it, so that edit sets no size when only that axis would move.
export function selectionResizeEditFromDrag(args: {
  readonly handle: HandleKind;
  readonly bbox: AABB;
  readonly point: Vec2;
  readonly lockAspect: boolean;
}): Extract<SelectionTransformEdit, { kind: 'resize' }> {
  const { handle, bbox, point, lockAspect } = args;
  const spec = HANDLE_RESIZE[handle];
  let width = resizeExtent(spec.x, point.x, bbox.minX, bbox.maxX);
  let height = resizeExtent(spec.y, point.y, bbox.minY, bbox.maxY);
  const isCorner = spec.x !== undefined && spec.y !== undefined;
  const originalWidth = bbox.maxX - bbox.minX;
  const originalHeight = bbox.maxY - bbox.minY;
  if (
    isCorner &&
    lockAspect &&
    width !== undefined &&
    height !== undefined &&
    originalWidth > 0 &&
    originalHeight > 0
  ) {
    // Numeric resize gives one controlling dimension. A corner drag gives two:
    // follow the axis with the larger proportional travel, including shrinking.
    const sx = width / originalWidth;
    const sy = height / originalHeight;
    const scale = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
    width = originalWidth * scale;
    height = originalHeight * scale;
  }
  return {
    kind: 'resize',
    anchor: spec.anchor,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    preserveAspect: isCorner ? lockAspect : false,
  };
}

/** Whether a handle resize edit changes any size. */
export function resizeEditSetsSize(
  edit: Extract<SelectionTransformEdit, { kind: 'resize' }>,
): boolean {
  return edit.width !== undefined || edit.height !== undefined;
}

function hasExtent(min: number, max: number): boolean {
  return max - min > FLAT_EXTENT_MM;
}

// New extent along one axis: the handle grows from the far/near edge toward
// the pointer, clamped positive.
function resizeExtent(
  side: 'east' | 'west' | 'north' | 'south' | undefined,
  pointer: number,
  min: number,
  max: number,
): number | undefined {
  if (side === undefined || !hasExtent(min, max)) return undefined;
  const growsFromMin = side === 'east' || side === 'south';
  return Math.max(MIN_SELECTION_DIMENSION_MM, growsFromMin ? pointer - min : max - pointer);
}
