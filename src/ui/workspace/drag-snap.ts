import type { Project, SceneObject, SelectionAnchor, Transform, Vec2 } from '../../core/scene';
import { nextTransformForDrag, type DragState } from './drag-state';
import { snapMoveTransform, type SnapGuide, type SnapSettings } from './snapping';

type TransformDrag = Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' | 'measure' }>;

type DragEventModifiers = {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
};

export type TransformDragWithSnapResult = {
  readonly transform: Transform;
  readonly guides: ReadonlyArray<SnapGuide>;
};

export function transformDragWithSnap(args: {
  readonly drag: TransformDrag;
  readonly object: SceneObject;
  readonly point: Vec2;
  readonly event: DragEventModifiers;
  readonly project: Project;
  readonly snapSettings: SnapSettings;
  readonly selectionAnchor?: SelectionAnchor;
  readonly ignoredSnapObjectIds?: ReadonlySet<string>;
}): TransformDragWithSnapResult {
  const transform = nextTransformForDrag(
    args.drag,
    args.object,
    args.point,
    args.event,
    args.selectionAnchor,
  );
  if (args.drag.kind !== 'move') return { transform, guides: [] };
  // Ctrl/Cmd temporarily disables snapping for this move (audit C4), matching
  // LightBurn. (For a scale drag Ctrl means from-center; move has no such
  // conflict since only move reaches the snapper.)
  if (args.event.ctrlKey || args.event.metaKey) return { transform, guides: [] };
  return snapMoveTransform({
    project: args.project,
    movingObjectId: args.drag.objectId,
    ...(args.ignoredSnapObjectIds === undefined
      ? {}
      : { ignoredObjectIds: args.ignoredSnapObjectIds }),
    proposedTransform: transform,
    settings: args.snapSettings,
  });
}
