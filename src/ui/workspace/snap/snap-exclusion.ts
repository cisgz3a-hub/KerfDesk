// snap-exclusion — geometry that must not be a snap target for this gesture.
//
// Whatever is moving under the pointer cannot be a target: snapping to it makes
// the pointer chase geometry that is chasing the pointer. A move excludes the
// moving objects outright. A node drag is finer: only the dragged nodes, the
// midpoints and intersections of the segments they bend, and the centres they
// shift are dropped, so a node can still snap to another node of its own path —
// closing a shape, or lining a node up with its neighbour.

import type { PathNodeRef } from '../../state/path-node-edit-actions';

export type MovingNodes = {
  readonly objectId: string;
  // Keyed `${pathIndex}:${subpathIndex}`: the node indices moving there.
  readonly bySubpath: ReadonlyMap<string, ReadonlySet<number>>;
  readonly paths: ReadonlySet<number>;
};

export type SnapExclusion = {
  // Never targets (the objects being moved).
  readonly objectIds?: ReadonlySet<string>;
  // When set, ONLY these objects are searched (a moving object's own points,
  // when picking the point that was grabbed).
  readonly onlyObjectIds?: ReadonlySet<string>;
  readonly movingNodes?: MovingNodes;
};

export function subpathKey(pathIndex: number, subpathIndex: number): string {
  return `${pathIndex}:${subpathIndex}`;
}

export function movingNodesFromRefs(refs: ReadonlyArray<PathNodeRef>): MovingNodes | undefined {
  const first = refs[0];
  if (first === undefined) return undefined;
  const bySubpath = new Map<string, Set<number>>();
  const paths = new Set<number>();
  for (const ref of refs) {
    if (ref.objectId !== first.objectId) continue;
    const key = subpathKey(ref.pathIndex, ref.polylineIndex);
    const nodes = bySubpath.get(key) ?? new Set<number>();
    nodes.add(ref.pointIndex);
    bySubpath.set(key, nodes);
    paths.add(ref.pathIndex);
  }
  return { objectId: first.objectId, bySubpath, paths };
}

export function isObjectSearched(objectId: string, exclusion: SnapExclusion | undefined): boolean {
  if (exclusion === undefined) return true;
  if (exclusion.objectIds?.has(objectId) === true) return false;
  return exclusion.onlyObjectIds === undefined || exclusion.onlyObjectIds.has(objectId);
}

// The object's own box centre moves whenever one of its nodes does.
export function isObjectCentreMoving(
  objectId: string,
  exclusion: SnapExclusion | undefined,
): boolean {
  return exclusion?.movingNodes?.objectId === objectId;
}

export function isPointMoving(args: {
  readonly moving: MovingNodes;
  readonly pathIndex: number;
  readonly subpath: number;
  readonly kind: 'node' | 'midpoint' | 'center';
  readonly item: number;
  readonly nodeCount: number;
}): boolean {
  const nodes = args.moving.bySubpath.get(subpathKey(args.pathIndex, args.subpath));
  if (nodes === undefined) return false;
  if (args.kind === 'center') return true;
  if (args.kind === 'node') return nodes.has(args.item);
  const next = args.nodeCount > 0 ? (args.item + 1) % args.nodeCount : args.item + 1;
  return nodes.has(args.item) || nodes.has(next);
}

export function isSegmentMoving(args: {
  readonly moving: MovingNodes;
  readonly pathIndex: number;
  readonly subpath: number;
  readonly alignedWithCurves: boolean;
}): boolean {
  if (!args.moving.paths.has(args.pathIndex)) return false;
  if (!args.alignedWithCurves) return true;
  return args.moving.bySubpath.has(subpathKey(args.pathIndex, args.subpath));
}
