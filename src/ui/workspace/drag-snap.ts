import type { Project, SceneObject, SelectionAnchor, Transform, Vec2 } from '../../core/scene';
import { nextTransformForDrag, type DragState } from './drag-state';
import { snapMoveToPoint } from './snap/move-point-snap';
import { snapReachMm } from './snap/pointer-snap';
import type { SnapMarker } from './snap/snap-kinds';
import { snapMoveTransform, type SnapGuide, type SnapSettings } from './snapping';

type TransformDrag = Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' | 'measure' }>;

type DragEventModifiers = {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey?: boolean;
};

export type TransformDragWithSnapResult = {
  readonly transform: Transform;
  readonly guides: ReadonlyArray<SnapGuide>;
  readonly marker: SnapMarker | null;
};

export function transformDragWithSnap(args: {
  readonly drag: TransformDrag;
  readonly object: SceneObject;
  readonly point: Vec2;
  readonly event: DragEventModifiers;
  readonly project: Project;
  readonly snapSettings: SnapSettings;
  // Scene millimetres per canvas pixel at the current zoom.
  readonly pxToMm: number;
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
  if (args.drag.kind !== 'move') return { transform, guides: [], marker: null };
  // Alt suspends snapping for any drag; Ctrl/Cmd also does for a move (audit
  // C4), matching LightBurn. (For a scale drag Ctrl means from-center; move has
  // no such conflict since only move reaches the snapper.)
  if (args.event.ctrlKey || args.event.metaKey || args.event.altKey === true) {
    return { transform, guides: [], marker: null };
  }
  const distanceMm = snapReachMm(args.snapSettings, args.pxToMm);
  // The grabbed point snaps onto other artwork first; box alignment and the
  // grid apply only when no point is in reach. Shift's 45-degree constraint
  // owns the direction, so it skips the point snap.
  const pointSnap = args.event.shiftKey
    ? null
    : snapMoveToPoint({
        drag: args.drag,
        project: args.project,
        proposedTransform: transform,
        settings: args.snapSettings,
        radiusMm: distanceMm,
      });
  if (pointSnap !== null) return { ...pointSnap, guides: [] };
  const aligned = snapMoveTransform({
    project: args.project,
    movingObjectId: args.drag.objectId,
    ...(args.ignoredSnapObjectIds === undefined
      ? {}
      : { ignoredObjectIds: args.ignoredSnapObjectIds }),
    proposedTransform: transform,
    settings: args.snapSettings,
    distanceMm,
  });
  return { ...aligned, marker: null };
}
