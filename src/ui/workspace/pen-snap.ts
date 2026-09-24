// pen-snap — where a pen press lands (ADR-380). Object snaps rank by
// specificity, then distance, with the shared snap engine's rules: a node
// beats an intersection, which beats a midpoint, which beats a point on a
// line. The grid applies only when no geometry is in reach, so a real node is
// never pulled onto a grid line. Reach is in screen pixels, like LightBurn's
// snap distance, and Alt widens it
// (https://docs.lightburnsoftware.com/2.1/Reference/Snapping/). The object-move
// snapping in snapping.ts is separate and unchanged; both honour the same
// snap settings.

import {
  closestPointOnSegment,
  intersectionTargets,
  isBetterSnap,
  type SnapKind,
  type SnapSegment,
} from '../../core/design/snap';
import {
  applyTransform,
  sceneLayerVisibility,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { isPenJoinableObject } from '../state/pen-path-join';
import type { PenEndpointRef, PenSnapKind } from './pen-draft';
import {
  boxReaches,
  penSnapDetails,
  penSnapObject,
  type PenSnapSubpath,
} from './pen-snap-geometry';
import type { SnapSettings } from './snapping';

export const PEN_SNAP_RADIUS_PX = 8;
// Alt reaches three times as far, for snapping to points from farther away.
const WIDE_SNAP_FACTOR = 3;

export type PenSnap = { readonly point: Vec2; readonly kind: PenSnapKind };

type Candidate = { readonly kind: SnapKind; readonly point: Vec2; readonly distanceMm: number };
type LayerLookup = ReturnType<typeof sceneLayerVisibility.lookup>;

export function penSnapReachMm(pxToMm: number, wide: boolean): number {
  return PEN_SNAP_RADIUS_PX * pxToMm * (wide ? WIDE_SNAP_FACTOR : 1);
}

export function resolvePenSnap(args: {
  readonly project: Project;
  readonly point: Vec2;
  readonly reachMm: number;
  readonly settings: SnapSettings;
}): PenSnap | null {
  if (!args.settings.enabled || !(args.reachMm > 0)) return null;
  if (args.settings.snapToObjects) {
    const geometric = nearestGeometrySnap(args.project, args.point, args.reachMm);
    if (geometric !== null) return { point: geometric.point, kind: geometric.kind };
  }
  if (!args.settings.snapToGrid) return null;
  // The grid pulls no farther than the object-move snap does, so zoomed out,
  // where a few pixels span millimetres, free drawing is not locked to it.
  const gridReachMm = Math.min(args.reachMm, args.settings.distanceMm);
  return gridSnap(args.point, args.settings.gridMm, gridReachMm);
}

function nearestGeometrySnap(project: Project, point: Vec2, reachMm: number): Candidate | null {
  const lookup = sceneLayerVisibility.lookup(project.scene.layers);
  const near: SnapSegment[] = [];
  let best: Candidate | null = null;
  const offer = (kind: SnapKind, at: Vec2): void => {
    const distanceMm = Math.hypot(at.x - point.x, at.y - point.y);
    if (distanceMm > reachMm || !isBetterSnap({ kind, distanceMm }, best)) return;
    best = { kind, point: at, distanceMm };
  };
  for (const object of project.scene.objects) {
    if (!sceneLayerVisibility.hasObject(object, lookup)) continue;
    const snap = penSnapObject(object);
    if (!boxReaches(snap.box, point, reachMm)) continue;
    snap.corners.forEach((corner) => offer('endpoint', corner));
    for (const subpath of reachableSubpaths(object, snap.subpaths, point, reachMm, lookup)) {
      const details = penSnapDetails(object, subpath);
      details.nodes.forEach((node) => offer('endpoint', node));
      details.midpoints.forEach((midpoint) => offer('midpoint', midpoint));
      for (const segment of details.segments) {
        if (!segmentReaches(segment, point, reachMm)) continue;
        near.push(segment);
        offer('on-line', closestPointOnSegment(point, segment));
      }
    }
  }
  intersectionTargets(near, point, reachMm).forEach((target) => offer(target.kind, target.atMm));
  return best;
}

function reachableSubpaths(
  object: SceneObject,
  subpaths: ReadonlyArray<PenSnapSubpath>,
  point: Vec2,
  reachMm: number,
  lookup: LayerLookup,
): ReadonlyArray<PenSnapSubpath> {
  if (!('paths' in object)) return [];
  return subpaths.filter((subpath) => {
    const path = object.paths[subpath.pathIndex];
    if (path === undefined || !boxReaches(subpath.box, point, reachMm)) return false;
    return sceneLayerVisibility.resolvePath(object, path, lookup).visible;
  });
}

function segmentReaches(segment: SnapSegment, point: Vec2, reachMm: number): boolean {
  return boxReaches(
    {
      minX: Math.min(segment.fromMm.x, segment.toMm.x),
      minY: Math.min(segment.fromMm.y, segment.toMm.y),
      maxX: Math.max(segment.fromMm.x, segment.toMm.x),
      maxY: Math.max(segment.fromMm.y, segment.toMm.y),
    },
    point,
    reachMm,
  );
}

// Each axis locks to its nearest grid line when that line is within reach, the
// same per-axis pull the object-move snap applies; both in reach is a corner.
function gridSnap(point: Vec2, gridMm: number, reachMm: number): PenSnap | null {
  if (!Number.isFinite(gridMm) || gridMm <= 0) return null;
  const x = Math.round(point.x / gridMm) * gridMm;
  const y = Math.round(point.y / gridMm) * gridMm;
  const snapX = Math.abs(x - point.x) <= reachMm;
  const snapY = Math.abs(y - point.y) <= reachMm;
  if (!snapX && !snapY) return null;
  return { point: { x: snapX ? x : point.x, y: snapY ? y : point.y }, kind: 'grid' };
}

/**
 * The open end of a pen drawing or path artwork nearest the pointer, for
 * continuing or joining it. Independent of the snap toggle: an end is a
 * place to join, not a snap preference.
 */
export function nearestJoinableEndpoint(args: {
  readonly project: Project;
  readonly point: Vec2;
  readonly reachMm: number;
  readonly exclude?: PenEndpointRef;
}): PenEndpointRef | null {
  const lookup = sceneLayerVisibility.lookup(args.project.scene.layers);
  let best: PenEndpointRef | null = null;
  let bestDistance = args.reachMm;
  for (const object of args.project.scene.objects) {
    if (!isPenJoinableObject(object) || !sceneLayerVisibility.hasObject(object, lookup)) continue;
    const snap = penSnapObject(object);
    if (!boxReaches(snap.box, args.point, args.reachMm)) continue;
    for (const subpath of reachableSubpaths(
      object,
      snap.subpaths,
      args.point,
      args.reachMm,
      lookup,
    )) {
      if (subpath.curve.closed) continue;
      for (const ref of subpathEnds(object, subpath)) {
        const distance = Math.hypot(ref.point.x - args.point.x, ref.point.y - args.point.y);
        if (distance > bestDistance || isSameEnd(ref, args.exclude)) continue;
        best = ref;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function subpathEnds(object: SceneObject, subpath: PenSnapSubpath): ReadonlyArray<PenEndpointRef> {
  const { curve, pathIndex, curveIndex } = subpath;
  const end = (which: PenEndpointRef['end'], local: Vec2): PenEndpointRef => ({
    objectId: object.id,
    pathIndex,
    curveIndex,
    end: which,
    point: applyTransform(local, object.transform),
  });
  const last = curve.segments[curve.segments.length - 1]?.to ?? curve.start;
  return [end('start', curve.start), end('end', last)];
}

function isSameEnd(ref: PenEndpointRef, other: PenEndpointRef | undefined): boolean {
  return (
    other !== undefined &&
    ref.objectId === other.objectId &&
    ref.pathIndex === other.pathIndex &&
    ref.curveIndex === other.curveIndex &&
    ref.end === other.end
  );
}
