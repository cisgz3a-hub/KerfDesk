import type { Project, SelectionAnchor, Transform, Vec2 } from '../../core/scene';
import { transformUpdatesForMoveDrag, type DragState } from './drag-state';
import { transformDragWithSnap } from './drag-snap';
import { rotateSelectionByDrag } from './rotate-handle';
import type { SnapGuide, SnapSettings } from './snapping';

type DragEventModifiers = {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
};

export function applyTransformDrag(args: {
  readonly drag: DragState | null;
  readonly point: Vec2 | null;
  readonly e: DragEventModifiers;
  readonly project: Project;
  readonly selectionAnchor: SelectionAnchor;
  readonly snapSettings: SnapSettings;
  readonly setObjectTransform: (id: string, transform: Transform) => void;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
}): void {
  const { drag, point } = args;
  if (!isTransformDrag(drag) || point === null) {
    args.setSnapGuides([]);
    return;
  }
  if (applySelectionRotateDrag({ ...args, drag, point })) return;
  const obj = args.project.scene.objects.find((o) => o.id === drag.objectId);
  if (obj === undefined) {
    args.setSnapGuides([]);
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
    selectionAnchor: args.selectionAnchor,
    ...(ignoredSnapObjectIds === undefined ? {} : { ignoredSnapObjectIds }),
  });
  args.setSnapGuides(result.guides);
  if (drag.kind === 'move') {
    transformUpdatesForMoveDrag(drag, result.transform).forEach((update) => {
      args.setObjectTransform(update.id, update.transform);
    });
    return;
  }
  args.setObjectTransform(drag.objectId, result.transform);
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

function applySelectionRotateDrag(args: {
  readonly drag: Extract<DragState, { kind: 'move' | 'scale' | 'rotate' }>;
  readonly point: Vec2;
  readonly e: DragEventModifiers;
  readonly setObjectTransform: (id: string, transform: Transform) => void;
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
  rotateSelectionByDrag({
    startTransforms: drag.selectionStartTransforms,
    anchor: drag.rotateAnchor,
    startPointerAngleDeg: drag.startPointerAngleDeg,
    dragTo: args.point,
    snap: args.e.shiftKey,
  }).forEach((update) => {
    args.setObjectTransform(update.id, update.transform);
  });
  return true;
}
