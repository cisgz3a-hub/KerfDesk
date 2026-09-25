// Snapping for node and handle drags (ADR-376). With canvas snapping on, a
// dragged node or handle lands on another node or a segment midpoint within
// the snap distance, else on the grid one axis at a time, as objects do.
// Nodes and midpoints come first: they are what the operator aims at, and a
// grid line through one would only compete with it. Object snapping itself is
// untouched; this reads the same settings.
//
// Targets come from the project as it was when the drag began, so they hold
// still while the drag reshapes the artwork. Whatever moves with the drag (the
// dragged nodes and the segments they bend) is left out.

import {
  applyTransform,
  curveNodeCount,
  curveNodePoint,
  sceneLayerVisibility,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import {
  explicitCurveSubpath,
  pointOnSegment,
  segmentStartPoint,
} from '../../core/geometry/curve-segment-geometry';
import {
  canonicalCurves,
  canonicalNodeIndex,
  canonicalSubpath,
  nodeEditableObject,
} from '../state/path-curve-object-edit';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import type { SnapGuide, SnapSettings } from './snapping';

export type PathNodeSnapExclusion = {
  /** Nodes that move with the drag, as snapTargetKey(…, node index). */
  readonly nodes: ReadonlySet<string>;
  /** Segments the drag reshapes, as snapTargetKey(…, segment index). */
  readonly segments: ReadonlySet<string>;
};

export type PathNodeSnapResult = {
  readonly point: Vec2;
  readonly guides: ReadonlyArray<SnapGuide>;
  /** The node or segment midpoint snapped to, if any. */
  readonly target: Vec2 | null;
};

type SubpathAt = {
  readonly object: SceneObject;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly curve: CurveSubpath;
};

let cachedTargets: {
  readonly project: Project;
  readonly key: string;
  readonly points: ReadonlyArray<Vec2>;
} | null = null;

export function snapTargetKey(
  objectId: string,
  pathIndex: number,
  polylineIndex: number,
  index: number,
): string {
  return `${objectId}\u0000${pathIndex}\u0000${polylineIndex}\u0000${index}`;
}

export function snapPathNodePoint(args: {
  readonly project: Project;
  readonly point: Vec2;
  readonly settings: SnapSettings;
  readonly exclusion: PathNodeSnapExclusion;
}): PathNodeSnapResult {
  const unsnapped = { point: args.point, guides: [], target: null };
  if (!args.settings.enabled || !isPositiveFinite(args.settings.distanceMm)) return unsnapped;
  if (args.settings.snapToObjects) {
    const targets = snapTargets(args.project, args.exclusion);
    const target = nearestWithin(targets, args.point, args.settings.distanceMm);
    if (target !== null) return { point: target, guides: [], target };
  }
  return args.settings.snapToGrid ? gridSnap(args.project, args.point, args.settings) : unsnapped;
}

/** What a drag of `grabbed` moves: the anchors in `moving` with the segments
 *  on either side of them, or, for a handle, the segments at its node. */
export function snapExclusionForDrag(
  project: Project,
  grabbed: PathNodeRef,
  moving: ReadonlyArray<PathNodeRef>,
): PathNodeSnapExclusion {
  const nodes = new Set<string>();
  const segments = new Set<string>();
  const { handle, ...anchor } = grabbed;
  const anchors = handle === undefined ? moving : [anchor];
  for (const ref of anchors) {
    const object = nodeEditableObject(project, ref.objectId);
    const nodeIndex = object === null ? null : canonicalNodeIndex(object, ref);
    const curve =
      object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
    if (nodeIndex === null || curve === null) continue;
    const key = (index: number): string =>
      snapTargetKey(ref.objectId, ref.pathIndex, ref.polylineIndex, index);
    if (handle === undefined) nodes.add(key(nodeIndex));
    for (const index of adjacentSegments(curve, nodeIndex)) segments.add(key(index));
  }
  return { nodes, segments };
}

function adjacentSegments(curve: CurveSubpath, nodeIndex: number): ReadonlyArray<number> {
  const count = explicitCurveSubpath(curve).segments.length;
  const incoming = nodeIndex > 0 ? nodeIndex - 1 : curve.closed ? count - 1 : -1;
  return [incoming, nodeIndex < count ? nodeIndex : -1].filter((index) => index >= 0);
}

function snapTargets(project: Project, exclusion: PathNodeSnapExclusion): ReadonlyArray<Vec2> {
  const key = [...exclusion.nodes, '', ...exclusion.segments].join('\u0001');
  if (cachedTargets?.project === project && cachedTargets.key === key) return cachedTargets.points;
  const points: Vec2[] = [];
  const lookup = sceneLayerVisibility.lookup(project.scene.layers);
  for (const object of project.scene.objects) {
    if (!('paths' in object)) continue;
    object.paths.forEach((path: ColoredPath, pathIndex: number) => {
      if (!sceneLayerVisibility.resolvePath(object, path, lookup).visible) return;
      canonicalCurves(path).forEach((curve, polylineIndex) =>
        addSubpathTargets(points, { object, pathIndex, polylineIndex, curve }, exclusion),
      );
    });
  }
  cachedTargets = { project, key, points };
  return points;
}

// Midpoints are taken at t = 0.5: exact for lines and circular arcs, close for
// curves, and cheap enough to offer every segment in the scene.
function addSubpathTargets(points: Vec2[], at: SubpathAt, exclusion: PathNodeSnapExclusion): void {
  const key = (index: number): string =>
    snapTargetKey(at.object.id, at.pathIndex, at.polylineIndex, index);
  for (let index = 0; index < curveNodeCount(at.curve); index += 1) {
    const node = curveNodePoint(at.curve, index);
    if (node !== null && !exclusion.nodes.has(key(index))) {
      points.push(applyTransform(node, at.object.transform));
    }
  }
  const explicit = explicitCurveSubpath(at.curve);
  explicit.segments.forEach((segment, index) => {
    const from = segmentStartPoint(explicit, index);
    if (from === null || exclusion.segments.has(key(index))) return;
    points.push(applyTransform(pointOnSegment(from, segment, 0.5), at.object.transform));
  });
}

function nearestWithin(points: ReadonlyArray<Vec2>, point: Vec2, radius: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDistance = radius;
  for (const candidate of points) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance > bestDistance) continue;
    best = candidate;
    bestDistance = distance;
  }
  return best;
}

// A point has no extent for a guide to span, so grid guides run across the bed.
function gridSnap(project: Project, point: Vec2, settings: SnapSettings): PathNodeSnapResult {
  if (!isPositiveFinite(settings.gridMm)) return { point, guides: [], target: null };
  const gridX = Math.round(point.x / settings.gridMm) * settings.gridMm;
  const gridY = Math.round(point.y / settings.gridMm) * settings.gridMm;
  const snapX = Math.abs(gridX - point.x) <= settings.distanceMm;
  const snapY = Math.abs(gridY - point.y) <= settings.distanceMm;
  const guides: SnapGuide[] = [];
  const { bedWidth, bedHeight } = project.device;
  if (snapX) guides.push({ axis: 'x', positionMm: gridX, fromMm: 0, toMm: bedHeight });
  if (snapY) guides.push({ axis: 'y', positionMm: gridY, fromMm: 0, toMm: bedWidth });
  return {
    point: { x: snapX ? gridX : point.x, y: snapY ? gridY : point.y },
    guides,
    target: null,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
