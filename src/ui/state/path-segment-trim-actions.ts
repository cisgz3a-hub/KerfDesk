// Trim (T) for node-edited artwork (ADR-376): cut the stretch under the
// cursor back to the nearest crossings. Crossings count with the artwork's
// own other lines and with any other visible vector artwork overlapping it,
// the way LightBurn's Extend already names "another shape"; the registration
// jig is a fixture, not artwork, and never cuts.

import {
  applyTransform,
  isRegistrationBox,
  sceneLayerVisibility,
  transformedBBox,
  type Bounds,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { trimCurveSubpath, type TrimCutter } from '../../core/geometry/curve-trim';
import type { AppState } from './store';
import type { PathSegmentRef } from './path-segment-ref';
import {
  canonicalSubpath,
  committedObjectEdit,
  nodeEditableObject,
  objectWithSubpathPieces,
  type NodeEditableObject,
} from './path-curve-object-edit';
import { runEdit } from './path-segment-edit-actions';

export type PathSegmentTrimOutcome = 'trimmed' | 'no-crossing' | 'unchanged';

export type PathSegmentTrimActions = {
  /** Trim around parameter `t` of the segment (where the cursor is). */
  readonly trimPathSegment: (ref: PathSegmentRef, t: number) => PathSegmentTrimOutcome;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

// Crossings are found on the path sampled this close to the true curve, in
// scene millimetres, so the cut lands within a hundredth of a millimetre.
const TRIM_SCENE_TOLERANCE_MM = 0.01;

export function pathSegmentTrimActions(set: Setter): PathSegmentTrimActions {
  return {
    trimPathSegment: (ref, t) => {
      let outcome: PathSegmentTrimOutcome = 'unchanged';
      runEdit(set, (state) => {
        const result = trimSegment(state, ref, t);
        outcome = result.outcome;
        return result.edit;
      });
      return outcome;
    },
  };
}

function trimSegment(
  state: AppState,
  ref: PathSegmentRef,
  t: number,
): { readonly edit: Partial<AppState> | null; readonly outcome: PathSegmentTrimOutcome } {
  const object = nodeEditableObject(state.project, ref.objectId);
  const subpath =
    object === null ? null : canonicalSubpath(object, ref.pathIndex, ref.polylineIndex);
  if (object === null || subpath === null || !Number.isFinite(t)) {
    return { edit: null, outcome: 'unchanged' };
  }
  const result = trimCurveSubpath({
    path: subpath,
    cursor: { segmentIndex: ref.segmentIndex, t },
    toShared: (point) => applyTransform(point, object.transform),
    cutters: trimCutters(state.project.scene, object, ref),
    tolerance: localTolerance(object.transform),
  });
  if (result.kind === 'no-crossing') return { edit: null, outcome: 'no-crossing' };
  const next = objectWithSubpathPieces(object, { ...ref, pieces: result.pieces });
  if (next === null) return { edit: null, outcome: 'unchanged' };
  return { edit: committedObjectEdit(state, next), outcome: 'trimmed' };
}

export function trimCutters(
  scene: Scene,
  object: NodeEditableObject,
  ref: PathSegmentRef,
): ReadonlyArray<TrimCutter> {
  const trimmed = object.paths[ref.pathIndex]?.polylines[ref.polylineIndex];
  const reach =
    trimmed === undefined ? null : pointsBounds(scenePolyline(trimmed, object.transform));
  return artworkCutters(scene, object, {
    skip: ref,
    reaches: (bounds) => reach !== null && overlaps(bounds, reach),
  });
}

/** Scene polylines of visible vector artwork: the object's own lines but
 *  `skip`, and those of other artwork whose box `reaches` accepts. */
export function artworkCutters(
  scene: Scene,
  object: NodeEditableObject,
  options: {
    readonly skip: { readonly pathIndex: number; readonly polylineIndex: number } | null;
    readonly reaches: (bounds: Bounds) => boolean;
  },
): ReadonlyArray<TrimCutter> {
  const lookup = sceneLayerVisibility.lookup(scene.layers);
  const { skip } = options;
  const own = visiblePolylines(object, lookup).flatMap((entry) =>
    skip !== null &&
    entry.pathIndex === skip.pathIndex &&
    entry.polylineIndex === skip.polylineIndex
      ? []
      : [scenePolyline(entry.polyline, object.transform)],
  );
  const others = scene.objects.flatMap((other) => {
    if (other.id === object.id || !('paths' in other) || isRegistrationBox(other)) return [];
    if (!sceneLayerVisibility.hasObject(other, lookup)) return [];
    if (!options.reaches(transformedBBox(other))) return [];
    return visiblePolylines(other, lookup).map((entry) =>
      scenePolyline(entry.polyline, other.transform),
    );
  });
  return [...own, ...others];
}

type LayerLookup = ReturnType<typeof sceneLayerVisibility.lookup>;
type PathPolyline = {
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly polyline: Polyline;
};

function visiblePolylines(
  object: Extract<SceneObject, { readonly paths: unknown }>,
  lookup: LayerLookup,
): ReadonlyArray<PathPolyline> {
  return object.paths.flatMap((path, pathIndex) =>
    sceneLayerVisibility.resolvePath(object, path, lookup).visible
      ? path.polylines.map((polyline, polylineIndex) => ({ pathIndex, polylineIndex, polyline }))
      : [],
  );
}

function scenePolyline(polyline: Polyline, transform: Transform): TrimCutter {
  const points = polyline.points.map((point) => applyTransform(point, transform));
  const first = points[0];
  const last = points.at(-1);
  const reopen = polyline.closed && first !== undefined && last !== undefined;
  return reopen && (first.x !== last.x || first.y !== last.y) ? [...points, first] : points;
}

function pointsBounds(points: ReadonlyArray<Vec2>): Bounds | null {
  const first = points[0];
  if (first === undefined) return null;
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y },
  );
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function localTolerance(transform: Transform): number {
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  return Number.isFinite(scale) && scale > 0
    ? TRIM_SCENE_TOLERANCE_MM / scale
    : TRIM_SCENE_TOLERANCE_MM;
}
