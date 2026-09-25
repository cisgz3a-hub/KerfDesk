// Node-editor commands on one segment or node of canonical or legacy path
// artwork (ADR-376), each a single undo step: insert a node (at the cursor or
// the segment's midpoint), delete a segment, break at a node, turn a segment
// into a curve or a line, and make a node smooth or a corner. Keyboard keys,
// the node toolbar and double-click all land here.

import {
  isSmoothCurveNode,
  replaceSegments,
  smoothCurveNodeOfAnyKind,
} from '../../core/geometry/curve-node-shape';
import { cornerCurveNode, type CurveSubpath, type PathSegment } from '../../core/scene';
import {
  explicitCurveSubpath,
  sameCurveSubpath,
  segmentAsCubics,
  segmentParameterAtLength,
  segmentStartPoint,
} from '../../core/geometry/curve-segment-geometry';
import {
  breakCurveSubpathAtNode,
  deleteCurveSegment,
  insertCurveNode,
} from '../../core/geometry/curve-subpath-topology';
import type { AppState } from './store';
import type { PathNodeRef } from './path-node-edit-actions';
import type { PathSegmentRef } from './path-segment-ref';
import {
  canonicalNodeIndex,
  canonicalSubpath,
  committedObjectEdit,
  curveNodeRef,
  nodeEditableObject,
  objectWithSubpathPieces,
  type NodeEditableObject,
} from './path-curve-object-edit';

export type PathSegmentDeleteOutcome = 'deleted' | 'last-segment' | 'unchanged';
export type PathNodeSmoothness = 'toggle' | 'smooth' | 'corner';

export type PathSegmentEditActions = {
  /** Split the segment at parameter `t`; the new node becomes the selection. */
  readonly insertPathNode: (ref: PathSegmentRef, t: number) => boolean;
  /** Insert a node halfway along the segment, measured by length. */
  readonly insertPathNodeAtMidpoint: (ref: PathSegmentRef) => boolean;
  readonly deletePathSegment: (ref: PathSegmentRef) => PathSegmentDeleteOutcome;
  readonly breakPathAtNode: (ref: PathNodeRef) => boolean;
  readonly convertPathSegment: (ref: PathSegmentRef, kind: 'line' | 'cubic') => boolean;
  /** 'toggle' is the S key: a smooth node becomes a corner, any other node
   *  smooths. 'corner' turns the handles toward the neighbouring nodes. */
  readonly setPathNodeSmoothness: (ref: PathNodeRef, mode: PathNodeSmoothness) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type Edit = (state: AppState) => Partial<AppState> | null;

export function pathSegmentEditActions(set: Setter): PathSegmentEditActions {
  return {
    insertPathNode: (ref, t) => runEdit(set, (state) => insertNode(state, ref, () => t)),
    insertPathNodeAtMidpoint: (ref) =>
      runEdit(set, (state) =>
        insertNode(state, ref, (from, segment) => segmentParameterAtLength(from, segment, 0.5)),
      ),
    deletePathSegment: (ref) => {
      let outcome: PathSegmentDeleteOutcome = 'unchanged';
      runEdit(set, (state) => {
        const result = deleteSegment(state, ref);
        outcome = result.outcome;
        return result.edit;
      });
      return outcome;
    },
    breakPathAtNode: (ref) => runEdit(set, (state) => breakAtNode(state, ref)),
    convertPathSegment: (ref, kind) => runEdit(set, (state) => convertSegment(state, ref, kind)),
    setPathNodeSmoothness: (ref, mode) =>
      runEdit(set, (state) => setNodeSmoothness(state, ref, mode)),
  };
}

export function runEdit(set: Setter, edit: Edit): boolean {
  let changed = false;
  set((state) => {
    const next = edit(state);
    if (next === null) return state;
    changed = true;
    return next;
  });
  return changed;
}

type SegmentContext = {
  readonly object: NodeEditableObject;
  readonly subpath: CurveSubpath;
  readonly segment: PathSegment;
  readonly from: { readonly x: number; readonly y: number };
};

function segmentContext(state: AppState, ref: PathSegmentRef): SegmentContext | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const source =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (object === null || source === null) return null;
  const subpath = explicitCurveSubpath(source);
  const segment = subpath.segments[ref.segmentIndex];
  const from = segmentStartPoint(subpath, ref.segmentIndex);
  return segment === undefined || from === null ? null : { object, subpath, segment, from };
}

function insertNode(
  state: AppState,
  ref: PathSegmentRef,
  parameter: (from: SegmentContext['from'], segment: PathSegment) => number,
): Partial<AppState> | null {
  const context = segmentContext(state, ref);
  if (context === null) return null;
  const inserted = insertCurveNode(
    context.subpath,
    ref.segmentIndex,
    parameter(context.from, context.segment),
  );
  if (inserted === null) return null;
  const object = objectWithSubpathPieces(context.object, { ...ref, pieces: [inserted] });
  if (object === null) return null;
  const node = curveNodeRef(ref.objectId, ref.pathIndex, ref.polylineIndex, ref.segmentIndex + 1);
  return committedObjectEdit(state, object, [node]);
}

function deleteSegment(
  state: AppState,
  ref: PathSegmentRef,
): { readonly edit: Partial<AppState> | null; readonly outcome: PathSegmentDeleteOutcome } {
  const context = segmentContext(state, ref);
  const pieces = context === null ? null : deleteCurveSegment(context.subpath, ref.segmentIndex);
  if (context === null || pieces === null) return { edit: null, outcome: 'unchanged' };
  const object = objectWithSubpathPieces(context.object, { ...ref, pieces });
  if (object !== null) return { edit: committedObjectEdit(state, object), outcome: 'deleted' };
  // The segment is all that is left of the artwork: the caller removes the
  // artwork itself instead.
  const lastSegment =
    pieces.length === 0 &&
    context.object.paths.length === 1 &&
    context.object.paths[0]?.polylines.length === 1;
  return { edit: null, outcome: lastSegment ? 'last-segment' : 'unchanged' };
}

function breakAtNode(state: AppState, ref: PathNodeRef): Partial<AppState> | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const nodeIndex = object === null ? null : canonicalNodeIndex(object, ref);
  const subpath =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (object === null || nodeIndex === null || subpath === null) return null;
  const pieces = breakCurveSubpathAtNode(subpath, nodeIndex);
  if (pieces === null) return null;
  const next = objectWithSubpathPieces(object, { ...ref, pieces });
  return next === null ? null : committedObjectEdit(state, next);
}

function convertSegment(
  state: AppState,
  ref: PathSegmentRef,
  kind: 'line' | 'cubic',
): Partial<AppState> | null {
  const context = segmentContext(state, ref);
  if (context === null || context.segment.kind === kind) return null;
  const replacement: ReadonlyArray<PathSegment> =
    kind === 'line'
      ? [{ kind: 'line', to: context.segment.to }]
      : segmentAsCubics(context.from, context.segment);
  const converted = replaceSegments(context.subpath, ref.segmentIndex, replacement);
  const object = objectWithSubpathPieces(context.object, { ...ref, pieces: [converted] });
  return object === null ? null : committedObjectEdit(state, object);
}

function setNodeSmoothness(
  state: AppState,
  ref: PathNodeRef,
  mode: PathNodeSmoothness,
): Partial<AppState> | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const nodeIndex = object === null ? null : canonicalNodeIndex(object, ref);
  const subpath =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (object === null || nodeIndex === null || subpath === null) return null;
  const result = reshapedNode(subpath, nodeIndex, mode);
  if (result === null) return null;
  const next = objectWithSubpathPieces(object, { ...ref, pieces: [result.path] });
  if (next === null) return null;
  const node = curveNodeRef(ref.objectId, ref.pathIndex, ref.polylineIndex, result.nodeIndex);
  return committedObjectEdit(state, next, [node]);
}

// Null when the node already has the asked-for shape, so a repeated press
// leaves no empty undo step behind.
function reshapedNode(
  subpath: CurveSubpath,
  nodeIndex: number,
  mode: PathNodeSmoothness,
): { readonly path: CurveSubpath; readonly nodeIndex: number } | null {
  const smooth = isSmoothCurveNode(subpath, nodeIndex);
  if (mode === 'smooth' && smooth) return null;
  const corner = mode === 'corner' || (mode === 'toggle' && smooth);
  const result = corner
    ? { path: cornerCurveNode(subpath, nodeIndex), nodeIndex }
    : smoothCurveNodeOfAnyKind(subpath, nodeIndex);
  if (result === null || result.path === null) return null;
  return sameCurveSubpath(result.path, subpath)
    ? null
    : { path: result.path, nodeIndex: result.nodeIndex };
}
