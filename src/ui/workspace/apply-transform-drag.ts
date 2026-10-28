import {
  buildSelectionTransformEdit,
  selectionMetrics,
  type Project,
  type SelectionAnchor,
  type SelectionTransform,
  type Vec2,
} from '../../core/scene';
import { useToastStore } from '../state/toast-store';
import { transformUpdatesForMoveDrag, type DragState } from './drag-state';
import { transformDragWithSnap } from './drag-snap';
import { rotateSelectionByDrag } from './rotate-handle';
import { resizeEditSetsSize, selectionResizeEditFromDrag } from './selection-handles';
import type { SnapMarker } from './snap/snap-kinds';
import type { SnapGuide, SnapSettings } from './snapping';

type DragEventModifiers = {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey?: boolean;
};

export function applyTransformDrag(args: {
  readonly drag: DragState | null;
  readonly point: Vec2 | null;
  readonly e: DragEventModifiers;
  readonly project: Project;
  readonly selectionAnchor: SelectionAnchor;
  readonly snapSettings: SnapSettings;
  // Scene millimetres per canvas pixel, so the pixel snap reach tracks zoom.
  readonly pxToMm: number;
  // Each pointer move is one store write for the whole selection (J10-P2-1).
  readonly setObjectTransforms: (updates: ReadonlyArray<SelectionTransform>) => void;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
  readonly setSnapMarker: (next: SnapMarker | null) => void;
}): void {
  const { drag, point } = args;
  if (drag?.kind !== 'move') args.setSnapMarker(null);
  if (drag !== null && point !== null && applySelectionScaleDrag({ ...args, drag, point })) return;
  if (!isTransformDrag(drag) || point === null) {
    args.setSnapGuides([]);
    return;
  }
  if (applySelectionRotateDrag({ ...args, drag, point })) return;
  const obj = args.project.scene.objects.find((o) => o.id === drag.objectId);
  if (obj === undefined) {
    args.setSnapGuides([]);
    args.setSnapMarker(null);
    return;
  }
  const ignoredSnapObjectIds = ignoredSnapObjectIdsForDrag(drag);
  const result = transformDragWithSnap({
    drag,
    object: obj,
    point,
    event: args.e,
    project: args.project,
    snapSettings: args.snapSettings,
    pxToMm: args.pxToMm,
    selectionAnchor: args.selectionAnchor,
    ...(ignoredSnapObjectIds === undefined ? {} : { ignoredSnapObjectIds }),
  });
  args.setSnapGuides(result.guides);
  args.setSnapMarker(result.marker);
  if (drag.kind === 'move') {
    args.setObjectTransforms(transformUpdatesForMoveDrag(drag, result.transform));
    return;
  }
  args.setObjectTransforms([{ id: drag.objectId, transform: result.transform }]);
}

function ignoredSnapObjectIdsForDrag(
  drag: Extract<DragState, { kind: 'move' | 'scale' | 'rotate' }>,
): ReadonlySet<string> | undefined {
  if (
    drag.kind !== 'move' ||
    drag.selectionStartTransforms === undefined ||
    drag.selectionStartTransforms.length <= 1
  ) {
    return undefined;
  }
  return new Set(drag.selectionStartTransforms.map((entry) => entry.id));
}

function isTransformDrag(
  drag: DragState | null,
): drag is Extract<DragState, { kind: 'move' | 'scale' | 'rotate' }> {
  return drag?.kind === 'move' || drag?.kind === 'scale' || drag?.kind === 'rotate';
}

// Multi-object handle resize (audit C5): scale every listed object about the
// opposite corner/edge via the core group-resize, the same path the numeric
// W/H fields use. Applied to the CURRENT objects each frame — factors are
// target/current, so the size is absolute, not compounding. Shift frees the
// aspect on corner handles.
function applySelectionScaleDrag(args: {
  readonly drag: DragState;
  readonly point: Vec2;
  readonly e: DragEventModifiers;
  readonly project: Project;
  readonly setObjectTransforms: (updates: ReadonlyArray<SelectionTransform>) => void;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
}): boolean {
  if (args.drag.kind !== 'selection-scale') return false;
  args.setSnapGuides([]);
  const ids = new Set(args.drag.selectionIds);
  const objects = args.project.scene.objects.filter((object) => ids.has(object.id));
  const metrics = selectionMetrics(objects);
  if (metrics === null) return true;
  const edit = selectionResizeEditFromDrag({
    handle: args.drag.handle,
    bbox: metrics.bbox,
    point: args.point,
    lockAspect: !args.e.shiftKey,
  });
  // Only the axis of collinear straight lines moved: there is no size to change.
  if (!resizeEditSetsSize(edit)) return true;
  const result = buildSelectionTransformEdit(objects, edit);
  if (result.kind === 'ok') {
    args.setObjectTransforms(result.transforms);
  } else if (result.reason === 'non-uniform-rotated-selection') {
    reportObliqueStretch();
  }
  return true;
}

const OBLIQUE_STRETCH_MESSAGE =
  'An object in the selection is turned at an angle that is not a multiple of 90°, so the selection can only be scaled evenly: drag a corner handle without Shift.';

// The handle would otherwise do nothing at all. Every pointer move meets the
// same refusal, so one copy is shown at a time.
function reportObliqueStretch(): void {
  const toasts = useToastStore.getState();
  if (toasts.toasts.some((toast) => toast.message === OBLIQUE_STRETCH_MESSAGE)) return;
  toasts.pushToast(OBLIQUE_STRETCH_MESSAGE, 'info');
}

function applySelectionRotateDrag(args: {
  readonly drag: Extract<DragState, { kind: 'move' | 'scale' | 'rotate' }>;
  readonly point: Vec2;
  readonly e: DragEventModifiers;
  readonly setObjectTransforms: (updates: ReadonlyArray<SelectionTransform>) => void;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
}): boolean {
  const { drag } = args;
  if (
    drag.kind !== 'rotate' ||
    drag.selectionStartTransforms === undefined ||
    drag.selectionStartTransforms.length <= 1 ||
    drag.rotateAnchor === undefined ||
    drag.startPointerAngleDeg === undefined
  ) {
    return false;
  }
  args.setSnapGuides([]);
  args.setObjectTransforms(
    rotateSelectionByDrag({
      startTransforms: drag.selectionStartTransforms,
      anchor: drag.rotateAnchor,
      startPointerAngleDeg: drag.startPointerAngleDeg,
      dragTo: args.point,
      snap: args.e.shiftKey,
    }),
  );
  return true;
}
