// Where a dragged node or handle lands (ADR-376). In order of precedence: an
// open end dropped on another open end of the same path snaps onto it and is
// joined on release (LightBurn joins nodes dragged on top of one another);
// Shift keeps the move on a 0°, 45° or 90° line from where the item started,
// with a guide along it; otherwise canvas snapping applies.

import {
  applyTransform,
  curveNodeCount,
  curveNodePoint,
  type CurveSubpath,
  type Project,
  type Vec2,
} from '../../core/scene';
import {
  canonicalCurves,
  canonicalNodeIndex,
  curveNodeRef,
  nodeEditableObject,
  type NodeEditableObject,
} from '../state/path-curve-object-edit';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import type { NodeDragFeedback, NodeJoinCue } from './node-edit-store';
import { PATH_NODE_HIT_RADIUS_PX } from './path-node-hit-test';
import { snapExclusionForDrag, snapPathNodePoint } from './path-node-snap';
import type { SnapGuide, SnapSettings } from './snapping';

export type NodeDragLanding = {
  readonly point: Vec2;
  readonly guides: ReadonlyArray<SnapGuide>;
  readonly feedback: NodeDragFeedback;
};

// Unit steps of 45°, exact so a constrained coordinate equals the start's.
const OCTANT_DIRECTIONS: ReadonlyArray<Vec2> = [
  { x: 1, y: 0 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: 0, y: 1 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -1, y: 0 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
];

export function nodeDragLanding(args: {
  /** The project as it was when the drag began. */
  readonly project: Project;
  readonly grabbed: PathNodeRef;
  /** Anchors that move with the drag (none when a handle is dragged). */
  readonly moving: ReadonlyArray<PathNodeRef>;
  readonly origin: Vec2;
  /** Where the pointer would put the grabbed item, before any constraint. */
  readonly proposed: Vec2;
  readonly pxToMm: number;
  readonly constrain: boolean;
  /** Canvas snap settings, or null while snapping is off or suspended. */
  readonly snap: SnapSettings | null;
}): NodeDragLanding {
  const join = joinCueAt(args);
  if (join !== null) return landed(join.point, [], { join, snapPoint: null, constraint: null });
  if (args.constrain) {
    const point = constrainToOctant(args.origin, args.proposed);
    const constraint = { from: args.origin, to: point };
    return landed(point, [], { join: null, snapPoint: null, constraint });
  }
  if (args.snap === null) return landed(args.proposed, [], null);
  const snapped = snapPathNodePoint({
    project: args.project,
    point: args.proposed,
    settings: args.snap,
    exclusion: snapExclusionForDrag(args.project, args.grabbed, args.moving),
  });
  const feedback =
    snapped.target === null ? null : { join: null, snapPoint: snapped.target, constraint: null };
  return landed(snapped.point, snapped.guides, feedback);
}

/** The point on the nearest 45° line through `origin`, closest to `point`. */
export function constrainToOctant(origin: Vec2, point: Vec2): Vec2 {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (dx === 0 && dy === 0) return origin;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const direction = OCTANT_DIRECTIONS[(octant + 8) % 8] as Vec2;
  const along = dx * direction.x + dy * direction.y;
  return { x: origin.x + direction.x * along, y: origin.y + direction.y * along };
}

/** A single open end dragged within reach of another open end of its path. */
export function joinCueAt(args: {
  readonly project: Project;
  readonly grabbed: PathNodeRef;
  readonly moving: ReadonlyArray<PathNodeRef>;
  readonly proposed: Vec2;
  readonly pxToMm: number;
}): NodeJoinCue | null {
  const dragged = draggedOpenEnd(args);
  if (dragged === null) return null;
  const { grabbed } = args;
  let best: NodeJoinCue | null = null;
  let bestDistance = PATH_NODE_HIT_RADIUS_PX * args.pxToMm;
  for (const [polylineIndex, curve] of dragged.curves.entries()) {
    for (const end of joinableEnds(curve, polylineIndex, grabbed, dragged.node)) {
      const local = curveNodePoint(curve, end);
      if (local === null) continue;
      const point = applyTransform(local, dragged.object.transform);
      const distance = Math.hypot(point.x - args.proposed.x, point.y - args.proposed.y);
      if (distance > bestDistance) continue;
      bestDistance = distance;
      const target = curveNodeRef(grabbed.objectId, grabbed.pathIndex, polylineIndex, end);
      best = { dragged: grabbed, target, point };
    }
  }
  return best;
}

type DraggedEnd = {
  readonly object: NodeEditableObject;
  readonly curves: ReadonlyArray<CurveSubpath>;
  readonly node: number;
};

function draggedOpenEnd(args: {
  readonly project: Project;
  readonly grabbed: PathNodeRef;
  readonly moving: ReadonlyArray<PathNodeRef>;
}): DraggedEnd | null {
  const { grabbed } = args;
  if (args.moving.length !== 1 || grabbed.handle !== undefined) return null;
  const object = nodeEditableObject(args.project, grabbed.objectId);
  const path = object?.paths[grabbed.pathIndex];
  if (object === null || path === undefined) return null;
  const node = canonicalNodeIndex(object, grabbed);
  const curves = canonicalCurves(path);
  const own = curves[grabbed.polylineIndex];
  if (node === null || own === undefined || !openEnds(own).includes(node)) return null;
  return { object, curves, node };
}

function joinableEnds(
  curve: CurveSubpath,
  polylineIndex: number,
  grabbed: PathNodeRef,
  node: number,
): ReadonlyArray<number> {
  if (polylineIndex !== grabbed.polylineIndex) return openEnds(curve);
  // Closing a subpath on itself needs three nodes to enclose anything.
  return curveNodeCount(curve) < 3 ? [] : openEnds(curve).filter((end) => end !== node);
}

function openEnds(curve: CurveSubpath): ReadonlyArray<number> {
  return curve.closed ? [] : [0, curveNodeCount(curve) - 1];
}

function landed(
  point: Vec2,
  guides: ReadonlyArray<SnapGuide>,
  feedback: NodeDragFeedback | null,
): NodeDragLanding {
  return { point, guides, feedback: feedback ?? { join: null, snapPoint: null, constraint: null } };
}
