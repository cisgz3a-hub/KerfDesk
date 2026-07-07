import type { Project, Vec2 } from '../../core/scene';
import { pathNodeRefsEqual, type PathNodeRef } from '../state/path-node-edit-actions';
import { hitPathNode } from './path-node-hit-test';

export type PathNodeDragState = {
  readonly kind: 'path-node';
  readonly startScenePoint: Vec2;
};

export function beginPathNodeDrag(args: {
  readonly project: Project;
  readonly scenePoint: Vec2;
  readonly pxToMm: number;
  readonly additive?: boolean;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly selectPathNode: (
    ref: PathNodeRef | null,
    options?: { readonly additive?: boolean },
  ) => void;
}): PathNodeDragState | null {
  const ref = hitPathNode(args.project.scene, args.scenePoint, args.pxToMm);
  if (ref === null) {
    args.selectPathNode(null);
    return null;
  }
  // A plain click on a node already in the multi-selection keeps the whole set
  // and drags it (audit C6) — same rule as dragging an already-selected object.
  // Shift toggles; a click on an unselected node selects just it.
  const alreadySelected = args.selectedPathNodes.some((selected) =>
    pathNodeRefsEqual(selected, ref),
  );
  if (args.additive === true || !alreadySelected) {
    args.selectPathNode(ref, { additive: args.additive === true });
  }
  return { kind: 'path-node', startScenePoint: args.scenePoint };
}

export function updatePathNodeDrag(args: {
  readonly drag: PathNodeDragState;
  readonly point: Vec2 | null;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
}): void {
  if (args.point === null) return;
  args.setSelectedPathNodePositionDuringInteraction(args.point);
}
