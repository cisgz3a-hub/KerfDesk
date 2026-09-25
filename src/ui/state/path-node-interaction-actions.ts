// Live node-editor drags (ADR-376). Each runs inside the canvas interaction
// snapshot, so the whole gesture — including an auto-join on release — is one
// undo step and Esc restores the start. Reshaping reads the pre-drag geometry
// from that snapshot: a segment bend is recomputed from the original curve on
// every move, and a handle keeps its node smooth only if the node was smooth
// when the drag began.

import {
  bendCurveSegment,
  cubicSegmentForBend,
  isSmoothCurveNode,
  moveCurveHandle,
} from '../../core/geometry/curve-node-shape';
import {
  curveEndpointJoin,
  curveNodePoint,
  moveCurveAnchor,
  type CurveSubpath,
  type Project,
  type Vec2,
} from '../../core/scene';
import type { AppState } from './store';
import {
  pathNodeRefsEqual,
  scenePointToObjectLocal,
  type PathNodeRef,
} from './path-node-edit-actions';
import { editPathsNodesByDelta, pathNodePoint } from './path-node-edit-geometry';
import type { PathSegmentRef } from './path-segment-ref';
import {
  canonicalCurves,
  canonicalNodeIndex,
  canonicalSubpath,
  nodeEditableObject,
  objectWithPathCurves,
  objectWithSubpathPieces,
  projectWithObject,
  rebuildNodeEditableObject,
  type NodeEditableObject,
} from './path-curve-object-edit';
import { runEdit } from './path-segment-edit-actions';

export type PathNodeInteractionActions = {
  /** Move the selected nodes so `grabbed` lands on `scenePoint`. A grabbed
   *  handle keeps a smooth node smooth; `mirrorHandle` also matches lengths. */
  readonly moveSelectedPathNodesDuringInteraction: (
    grabbed: PathNodeRef,
    scenePoint: Vec2,
    options?: { readonly mirrorHandle?: boolean },
  ) => void;
  /** Reshape the segment so its point at `t` follows `scenePoint`. */
  readonly bendPathSegmentDuringInteraction: (
    ref: PathSegmentRef,
    t: number,
    scenePoint: Vec2,
  ) => void;
  /** Join two open end nodes of one path, closing it when they share a subpath. */
  readonly joinPathEndpointsDuringInteraction: (
    dragged: PathNodeRef,
    target: PathNodeRef,
  ) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeInteractionActions(set: Setter): PathNodeInteractionActions {
  return {
    moveSelectedPathNodesDuringInteraction: (grabbed, scenePoint, options = {}) =>
      set((state) => moveNodes(state, grabbed, scenePoint, options.mirrorHandle === true) ?? state),
    bendPathSegmentDuringInteraction: (ref, t, scenePoint) =>
      set((state) => bendSegment(state, ref, t, scenePoint) ?? state),
    joinPathEndpointsDuringInteraction: (dragged, target) =>
      runEdit(set, (state) => joinEndpoints(state, dragged, target)),
  };
}

function liveEdit(state: AppState, object: NodeEditableObject): Partial<AppState> {
  return { project: projectWithObject(state.project, object), dirty: true };
}

// The project as it was when the gesture began.
function gestureStart(state: AppState): Project {
  return state.pendingUndo?.project ?? state.project;
}

function moveNodes(
  state: AppState,
  grabbed: PathNodeRef,
  scenePoint: Vec2,
  mirrorHandle: boolean,
): Partial<AppState> | null {
  const object = nodeEditableObject(state.project, grabbed.objectId);
  const target = object === null ? null : scenePointToObjectLocal(scenePoint, object.transform);
  if (object === null || target === null) return null;
  if (grabbed.geometry === 'curve' && grabbed.handle !== undefined) {
    const moved = movedHandle(state, object, grabbed, grabbed.handle, target, mirrorHandle);
    return moved === null ? null : liveEdit(state, moved);
  }
  const current = pathNodePoint(object.paths, grabbed);
  if (current === null) return null;
  const selected = state.selectedPathNodes;
  const refs = selected.some((ref) => pathNodeRefsEqual(ref, grabbed)) ? selected : [grabbed];
  const edit = editPathsNodesByDelta(
    object.paths,
    refs,
    target.x - current.x,
    target.y - current.y,
  );
  return edit === null ? null : liveEdit(state, rebuildNodeEditableObject(object, edit.paths));
}

function movedHandle(
  state: AppState,
  object: NodeEditableObject,
  grabbed: PathNodeRef,
  side: 'incoming' | 'outgoing',
  target: Vec2,
  mirrorLength: boolean,
): NodeEditableObject | null {
  const curves = object.paths[grabbed.pathIndex]?.curves;
  const curve = curves?.[grabbed.polylineIndex];
  if (curves === undefined || curve === undefined) return null;
  const startObject = nodeEditableObject(gestureStart(state), grabbed.objectId);
  const startCurve = startObject?.paths[grabbed.pathIndex]?.curves?.[grabbed.polylineIndex];
  const keepSmooth = startCurve !== undefined && isSmoothCurveNode(startCurve, grabbed.pointIndex);
  const next = moveCurveHandle(curve, grabbed.pointIndex, side, target, {
    keepSmooth,
    mirrorLength,
  });
  if (next === null) return null;
  const nextCurves = curves.map((candidate, index) =>
    index === grabbed.polylineIndex ? next : candidate,
  );
  return objectWithPathCurves(object, grabbed.pathIndex, nextCurves, (anchor) => anchor);
}

function bendSegment(
  state: AppState,
  ref: PathSegmentRef,
  t: number,
  scenePoint: Vec2,
): Partial<AppState> | null {
  const original = nodeEditableObject(gestureStart(state), ref.objectId);
  const subpath =
    original === null ? null : canonicalSubpath(original, ref.pathIndex, ref.polylineIndex);
  const target = original === null ? null : scenePointToObjectLocal(scenePoint, original.transform);
  if (original === null || subpath === null || target === null) return null;
  const prepared = cubicSegmentForBend(subpath, ref.segmentIndex, t);
  const bent =
    prepared === null
      ? null
      : bendCurveSegment(prepared.path, prepared.segmentIndex, prepared.t, target);
  if (bent === null) return null;
  const next = objectWithSubpathPieces(original, { ...ref, pieces: [bent] });
  return next === null ? null : liveEdit(state, next);
}

function joinEndpoints(
  state: AppState,
  dragged: PathNodeRef,
  target: PathNodeRef,
): Partial<AppState> | null {
  if (dragged.objectId !== target.objectId || dragged.pathIndex !== target.pathIndex) return null;
  const object = nodeEditableObject(state.project, dragged.objectId);
  const path = object?.paths[dragged.pathIndex];
  const a = object === null ? null : canonicalNodeIndex(object, dragged);
  const b = object === null ? null : canonicalNodeIndex(object, target);
  if (object === null || path === undefined || a === null || b === null) return null;
  const curves = canonicalCurves(path);
  const next =
    dragged.polylineIndex === target.polylineIndex
      ? closedSubpath(object, dragged, curves, a, b)
      : joinedSubpaths(object, { ref: dragged, node: a }, { ref: target, node: b }, curves);
  if (next === null) return null;
  return { ...liveEdit(state, next), selectedPathNode: null, selectedPathNodes: [] };
}

function closedSubpath(
  object: NodeEditableObject,
  ref: PathNodeRef,
  curves: ReadonlyArray<CurveSubpath>,
  draggedNode: number,
  targetNode: number,
): NodeEditableObject | null {
  const curve = curves[ref.polylineIndex];
  const placed = curve === undefined ? null : placedOn(curve, draggedNode, curve, targetNode);
  const result = placed === null ? null : curveEndpointJoin.close(placed, draggedNode, targetNode);
  if (result?.kind !== 'ok') return null;
  return objectWithSubpathPieces(object, { ...ref, pieces: [result.curve] });
}

type JoinEnd = { readonly ref: PathNodeRef; readonly node: number };

function joinedSubpaths(
  object: NodeEditableObject,
  dragged: JoinEnd,
  target: JoinEnd,
  curves: ReadonlyArray<CurveSubpath>,
): NodeEditableObject | null {
  const draggedCurve = curves[dragged.ref.polylineIndex];
  const targetCurve = curves[target.ref.polylineIndex];
  if (draggedCurve === undefined || targetCurve === undefined) return null;
  const placed = placedOn(draggedCurve, dragged.node, targetCurve, target.node);
  if (placed === null) return null;
  // The earlier subpath keeps its place and takes the later one in, so the
  // rest of the path keeps its order.
  const [first, second] =
    dragged.ref.polylineIndex < target.ref.polylineIndex
      ? [
          { curve: placed, ...dragged },
          { curve: targetCurve, ...target },
        ]
      : [
          { curve: targetCurve, ...target },
          { curve: placed, ...dragged },
        ];
  const result = curveEndpointJoin.join(first.curve, first.node, second.curve, second.node);
  if (result.kind !== 'ok') return null;
  const removed = second.ref.polylineIndex;
  const nextCurves = curves.flatMap((curve, index) => {
    if (index === first.ref.polylineIndex) return [result.curve];
    return index === removed ? [] : [curve];
  });
  // Tabs on either joined contour have no reliable place on the new one.
  return objectWithPathCurves(object, dragged.ref.pathIndex, nextCurves, (anchor) => {
    if (anchor.polylineIndex === first.ref.polylineIndex || anchor.polylineIndex === removed) {
      return null;
    }
    return anchor.polylineIndex > removed
      ? { ...anchor, polylineIndex: anchor.polylineIndex - 1 }
      : anchor;
  });
}

// Put the dragged end exactly on the target so the join merges the two nodes
// instead of bridging a hair-width gap.
function placedOn(
  curve: CurveSubpath,
  nodeIndex: number,
  targetCurve: CurveSubpath,
  targetNode: number,
): CurveSubpath | null {
  const from = curveNodePoint(curve, nodeIndex);
  const to = curveNodePoint(targetCurve, targetNode);
  if (from === null || to === null) return null;
  if (from.x === to.x && from.y === to.y) return curve;
  return moveCurveAnchor(curve, nodeIndex, { x: to.x - from.x, y: to.y - from.y });
}
