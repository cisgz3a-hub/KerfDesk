import { applyTransform, type Project, type Vec2 } from '../../core/scene';
import { pathNodeRefsEqual, type PathNodeRef } from '../state/path-node-edit-actions';
import { pathNodePoint } from '../state/path-node-edit-geometry';
import { useStore } from '../state';
import { dropTarget } from '../state/path-node-drag-join-actions';
import { hitPathNode, PATH_NODE_HIT_RADIUS_PX } from './path-node-hit-test';
import { pxToMmForCanvas, type ViewState } from './view-transform';

export type PathNodeDragState = {
  readonly kind: 'path-node';
  readonly startScenePoint: Vec2;
  readonly startNodeScenePoint: Vec2;
  readonly startPrimaryScenePoint: Vec2;
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
  const ref = hitPathNode(args.project.scene, args.scenePoint, args.pxToMm, args.selectedPathNodes);
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
  // Toggling a node off is selection-only; dragging from it must not move the
  // remaining selected nodes.
  if (args.additive === true && alreadySelected) return null;
  // The selection reducer keeps the last selected ref as the primary. Keep
  // that primary when grabbing any selected node, without reordering the set.
  const primary = alreadySelected ? (args.selectedPathNodes.at(-1) ?? ref) : ref;
  const startNodeScenePoint = nodeScenePoint(args.project, ref);
  const startPrimaryScenePoint = nodeScenePoint(args.project, primary);
  if (startNodeScenePoint === null || startPrimaryScenePoint === null) return null;
  return {
    kind: 'path-node',
    startScenePoint: args.scenePoint,
    startNodeScenePoint,
    startPrimaryScenePoint,
  };
}

export function updatePathNodeDrag(args: {
  readonly drag: PathNodeDragState;
  readonly point: Vec2 | null;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
}): void {
  if (args.point === null) return;
  const { startScenePoint, startPrimaryScenePoint } = args.drag;
  args.setSelectedPathNodePositionDuringInteraction({
    x: startPrimaryScenePoint.x + args.point.x - startScenePoint.x,
    y: startPrimaryScenePoint.y + args.point.y - startScenePoint.y,
  });
}

/** Pointer up: dropping an open endpoint on another open endpoint of its path joins them. */
export function joinPathNodeOnDrop(
  canvas: HTMLCanvasElement | null,
  project: Project,
  viewState: ViewState,
): boolean {
  const state = useStore.getState();
  const dragged = state.selectedPathNode;
  if (dragged === null || dragged.handle !== undefined || state.selectedPathNodes.length !== 1) {
    return false;
  }
  const radiusMm = PATH_NODE_HIT_RADIUS_PX * pxToMmForCanvas(canvas, project, viewState);
  const target = dropTarget(state.project, dragged, radiusMm);
  return target !== null && state.joinDraggedPathNode(target);
}

function nodeScenePoint(project: Project, ref: PathNodeRef): Vec2 | null {
  const object = project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const point = pathNodePoint(object.paths, ref);
  return point === null ? null : applyTransform(point, object.transform);
}
