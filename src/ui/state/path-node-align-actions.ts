// The node editor's A key (ADR-376). With two or more nodes selected they line
// up horizontally or vertically on the node selected last; over a segment the
// artwork turns so that segment lies on the nearest horizontal, vertical or
// 45° line. Alignment is judged on the bed, so rotated or mirrored artwork
// lines up the way it looks.

import {
  alignNodePoints,
  nodeAlignAxis,
  segmentAlignRotationDeg,
} from '../../core/geometry/node-align';
import { applyTransform, buildSelectionTransformEdit, type Vec2 } from '../../core/scene';
import {
  explicitCurveSubpath,
  segmentStartPoint,
} from '../../core/geometry/curve-segment-geometry';
import type { AppState } from './store';
import {
  pathNodeRefsEqual,
  scenePointToObjectLocal,
  type PathNodeRef,
} from './path-node-edit-actions';
import { editPathsNodesByDelta, pathNodePoint } from './path-node-edit-geometry';
import type { PathSegmentRef } from './path-segment-ref';
import {
  canonicalSubpath,
  committedObjectEdit,
  nodeEditableObject,
  rebuildNodeEditableObject,
  type NodeEditableObject,
} from './path-curve-object-edit';
import { runEdit } from './path-segment-edit-actions';

export type PathNodeAlignActions = {
  readonly alignSelectedPathNodes: () => boolean;
  readonly alignPathSegmentAngle: (ref: PathSegmentRef) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeAlignActions(set: Setter): PathNodeAlignActions {
  return {
    alignSelectedPathNodes: () => runEdit(set, alignSelectedNodes),
    alignPathSegmentAngle: (ref) => runEdit(set, (state) => alignSegmentAngle(state, ref)),
  };
}

function alignSelectedNodes(state: AppState): Partial<AppState> | null {
  const anchors = state.selectedPathNodes.filter((ref) => ref.handle === undefined);
  const first = anchors[0];
  if (first === undefined || anchors.length < 2) return null;
  const object = nodeEditableObject(state.project, first.objectId);
  if (object === null || anchors.some((ref) => ref.objectId !== object.id)) return null;
  const aligned = alignedScenePoints(object, anchors, state.selectedPathNode);
  const paths = aligned === null ? null : pathsWithNodesAt(object, anchors, aligned);
  if (paths === null || paths === object.paths) return null;
  const next = rebuildNodeEditableObject(object, paths);
  return {
    ...committedObjectEdit(state, next, state.selectedPathNodes),
    selectedPathNode: state.selectedPathNode,
  };
}

// Where each anchor should go, lined up on the primary (last-selected) node.
function alignedScenePoints(
  object: NodeEditableObject,
  anchors: ReadonlyArray<PathNodeRef>,
  primary: PathNodeRef | null,
): ReadonlyArray<Vec2> | null {
  const scenePoints = anchors.map((ref) => nodeScenePoint(object, ref));
  if (scenePoints.some((point) => point === null)) return null;
  const points = scenePoints as ReadonlyArray<Vec2>;
  const axis = nodeAlignAxis(points);
  const referenceIndex = anchors.findIndex(
    (ref) => primary !== null && pathNodeRefsEqual(ref, primary),
  );
  const reference = points[referenceIndex >= 0 ? referenceIndex : points.length - 1];
  return axis === null || reference === undefined ? null : alignNodePoints(points, reference, axis);
}

function pathsWithNodesAt(
  object: NodeEditableObject,
  anchors: ReadonlyArray<PathNodeRef>,
  scenePoints: ReadonlyArray<Vec2>,
): NodeEditableObject['paths'] | null {
  let paths = object.paths;
  for (const [index, ref] of anchors.entries()) {
    const target = scenePointToObjectLocal(scenePoints[index] as Vec2, object.transform);
    const current = pathNodePoint(paths, ref);
    if (target === null || current === null) return null;
    if (target.x === current.x && target.y === current.y) continue;
    const edit = editPathsNodesByDelta(paths, [ref], target.x - current.x, target.y - current.y);
    if (edit === null) return null;
    paths = edit.paths;
  }
  return paths;
}

function alignSegmentAngle(state: AppState, ref: PathSegmentRef): Partial<AppState> | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const source =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (object === null || source === null) return null;
  const subpath = explicitCurveSubpath(source);
  const from = segmentStartPoint(subpath, ref.segmentIndex);
  const to = subpath.segments[ref.segmentIndex]?.to;
  if (from === null || to === undefined) return null;
  const delta = segmentAlignRotationDeg(
    applyTransform(from, object.transform),
    applyTransform(to, object.transform),
  );
  if (delta === null) return null;
  const result = buildSelectionTransformEdit([object], {
    kind: 'rotate',
    rotationDeg: object.transform.rotationDeg + delta,
  });
  const transform = result.kind === 'ok' ? result.transforms[0]?.transform : undefined;
  if (transform === undefined) return null;
  return {
    ...committedObjectEdit(state, { ...object, transform }, state.selectedPathNodes),
    selectedPathNode: state.selectedPathNode,
  };
}

function nodeScenePoint(object: NodeEditableObject, ref: PathNodeRef): Vec2 | null {
  const local = pathNodePoint(object.paths, ref);
  return local === null ? null : applyTransform(local, object.transform);
}
