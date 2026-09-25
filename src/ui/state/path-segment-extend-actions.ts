// Extend (E) for node-edited artwork (ADR-376): an open end runs on to the
// nearest line in its way, one of the artwork's own or of any other visible
// vector artwork, as LightBurn's Extend reaches "the nearest intersecting
// path". The registration jig is a fixture, not artwork, and never stops it.

import { applyTransform, type Bounds, type Vec2 } from '../../core/scene';
import {
  extendCurveEnd,
  extendRay,
  openEndOfNode,
  openEndOfSegment,
  type CurveEnd,
  type ExtendRay,
} from '../../core/geometry/curve-extend';
import type { AppState } from './store';
import type { PathNodeRef } from './path-node-edit-actions';
import type { PathSegmentRef } from './path-segment-ref';
import {
  canonicalNodeIndex,
  canonicalSubpath,
  committedObjectEdit,
  nodeEditableObject,
  objectWithSubpathPieces,
  type NodeEditableObject,
} from './path-curve-object-edit';
import { runEdit } from './path-segment-edit-actions';
import { artworkCutters } from './path-segment-trim-actions';

export type PathEndExtendOutcome = 'extended' | 'no-crossing' | 'no-open-end' | 'unchanged';

export type PathSegmentExtendActions = {
  /** Extend the open end the segment leads to; `t` picks the end of a lone segment. */
  readonly extendPathSegment: (ref: PathSegmentRef, t: number) => PathEndExtendOutcome;
  /** Extend the path from the open end node `ref`. */
  readonly extendPathAtNode: (ref: PathNodeRef) => PathEndExtendOutcome;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

type OpenEnd = {
  readonly object: NodeEditableObject;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly end: CurveEnd;
};

type ExtendEdit = {
  readonly edit: Partial<AppState> | null;
  readonly outcome: PathEndExtendOutcome;
};

// Artwork boxes are padded by this much (mm) so a line the ray runs exactly
// along is still looked at.
const BOX_SLACK_MM = 1e-6;

export function pathSegmentExtendActions(set: Setter): PathSegmentExtendActions {
  const extend = (find: (state: AppState) => OpenEnd | null): PathEndExtendOutcome => {
    let outcome: PathEndExtendOutcome = 'no-open-end';
    runEdit(set, (state) => {
      const target = find(state);
      if (target === null) return null;
      const result = extendEnd(state, target);
      outcome = result.outcome;
      return result.edit;
    });
    return outcome;
  };
  return {
    extendPathSegment: (ref, t) => extend((state) => segmentEnd(state, ref, t)),
    extendPathAtNode: (ref) => extend((state) => nodeEnd(state, ref)),
  };
}

function segmentEnd(state: AppState, ref: PathSegmentRef, t: number): OpenEnd | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const path = object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  const end = path === null ? null : openEndOfSegment(path, ref.segmentIndex, t);
  if (object === null || end === null) return null;
  return { object, pathIndex: ref.pathIndex, polylineIndex: ref.polylineIndex, end };
}

function nodeEnd(state: AppState, ref: PathNodeRef): OpenEnd | null {
  const object = nodeEditableObject(state.project, ref.objectId);
  const nodeIndex = object === null ? null : canonicalNodeIndex(object, ref);
  const path = object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  const end = path === null || nodeIndex === null ? null : openEndOfNode(path, nodeIndex);
  if (object === null || end === null) return null;
  return { object, pathIndex: ref.pathIndex, polylineIndex: ref.polylineIndex, end };
}

function extendEnd(state: AppState, target: OpenEnd): ExtendEdit {
  const { object, pathIndex, polylineIndex } = target;
  const path = canonicalSubpath(object, pathIndex, polylineIndex);
  if (path === null) return { edit: null, outcome: 'unchanged' };
  const toShared = (point: Vec2): Vec2 => applyTransform(point, object.transform);
  const ray = extendRay(path, target.end, toShared);
  if (ray === null) return { edit: null, outcome: 'no-crossing' };
  const cutters = artworkCutters(state.project.scene, object, {
    skip: null,
    reaches: (bounds) => rayMeetsBounds(ray, bounds),
  });
  const result = extendCurveEnd({ path, end: target.end, toShared, cutters });
  if (result.kind === 'no-crossing') return { edit: null, outcome: 'no-crossing' };
  const next = objectWithSubpathPieces(object, { pathIndex, polylineIndex, pieces: [result.path] });
  if (next === null) return { edit: null, outcome: 'unchanged' };
  return { edit: committedObjectEdit(state, next), outcome: 'extended' };
}

// Slab test: whether the ray, ahead of its origin, passes through the box.
function rayMeetsBounds(ray: ExtendRay, bounds: Bounds): boolean {
  const x = slab(ray.origin.x, ray.direction.x, bounds.minX, bounds.maxX);
  const y = slab(ray.origin.y, ray.direction.y, bounds.minY, bounds.maxY);
  if (x === null || y === null) return false;
  return Math.max(0, x.near, y.near) <= Math.min(x.far, y.far);
}

function slab(
  origin: number,
  direction: number,
  min: number,
  max: number,
): { readonly near: number; readonly far: number } | null {
  const low = min - BOX_SLACK_MM;
  const high = max + BOX_SLACK_MM;
  if (direction === 0) {
    return origin < low || origin > high ? null : { near: -Infinity, far: Infinity };
  }
  const a = (low - origin) / direction;
  const b = (high - origin) / direction;
  return { near: Math.min(a, b), far: Math.max(a, b) };
}
