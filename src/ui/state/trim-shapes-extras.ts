// Trim Shapes options (LightBurn): auto-join and preserve the trimmed segment.
//
// Auto-join (on unless Ctrl is held): the trimmed object's pieces are joined
// at the points where they were cut to any open contour meeting them there,
// its own or another unlocked object's path that cuts identically: the same
// effective operations (path binding, else artwork binding, else colour),
// colour, power scale and overrides. A
// partner contour is carried into the trimmed object's coordinates exactly
// and removed from where it was; an object left with nothing is deleted.
//
// Preserve (Shift): a copy of the deleted stretch, exact, is added as its own
// path artwork on the current drawing layer.

import { joinTouchingContours, type JoinCandidate } from '../../core/geometry/contour-auto-join';
import {
  bakeCurves,
  invertAffine,
  multiplyAffine,
  transformAffine,
} from '../../core/geometry/shear-bake';
import type { TrimEdit } from '../../core/geometry/trim-shape-edit';
import type { AffineMatrix } from '../../core/vector-export/affine-curves';
import { pathJoinSignature } from '../../core/geometry/vector-path-join';
import { boundsForPaths } from '../../core/geometry/vector-path-tools';
import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { materializeCurves } from './path-node-curve-command-actions';

const JOIN_TOLERANCE_MM = 1e-3;

type PathArtwork = Extract<SceneObject, { readonly kind: 'imported-svg' | 'traced-image' }>;

function isPathArtwork(object: SceneObject): object is PathArtwork {
  return object.kind === 'imported-svg' || object.kind === 'traced-image';
}

function contoursOf(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}

type Partner = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly curveIndex: number;
};

/** The scene objects after joining the trimmed object's cut ends; null when nothing joined. */
export function autoJoinTrimmed(
  objects: ReadonlyArray<SceneObject>,
  trimmed: SceneObject,
  edit: TrimEdit,
  operations: ReadonlyArray<Layer>,
): { readonly objects: ReadonlyArray<SceneObject>; readonly joins: number } | null {
  if (!isPathArtwork(trimmed) || edit.pathRemoved || edit.cutPoints.length === 0) return null;
  const path = trimmed.paths[edit.pathIndex];
  const inverse = invertAffine(transformAffine(trimmed.transform));
  if (path === undefined || inverse === null) return null;
  const cutsWorld = edit.cutPoints.map((point) => applyTransform(point, trimmed.transform));
  const touches = (curve: CurveSubpath, object: SceneObject) =>
    [curve.start, curve.segments.at(-1)?.to ?? curve.start].some((end) => {
      const world = applyTransform(end, object.transform);
      return cutsWorld.some(
        (cut) => Math.hypot(cut.x - world.x, cut.y - world.y) <= JOIN_TOLERANCE_MM,
      );
    });
  const own: JoinCandidate[] = contoursOf(path).map((curve) => ({ curve, anchored: true }));
  const signature = pathJoinSignature(trimmed, path, operations);
  const sameCut = (object: PathArtwork, candidate: ColoredPath) =>
    pathJoinSignature(object, candidate, operations) === signature;
  const { partners, foreign } = partnerContours(objects, trimmed, inverse, sameCut, touches);
  const scale = Math.max(Math.abs(trimmed.transform.scaleX), Math.abs(trimmed.transform.scaleY));
  const result = joinTouchingContours(
    [...own, ...foreign],
    edit.cutPoints,
    JOIN_TOLERANCE_MM / scale,
  );
  if (result.joins === 0) return null;
  const kept = result.contours
    .filter((contour) => contour.anchored)
    .map((contour) => contour.curve);
  const consumed = new Set(
    result.contours
      .filter((contour) => contour.anchored)
      .flatMap((contour) => contour.sources)
      .filter((source) => source >= own.length)
      .map((source) => partners[source - own.length])
      .filter((partner): partner is Partner => partner !== undefined)
      .map(partnerKey),
  );
  const nextPath = materializeCurves(path, kept);
  if (nextPath === null) return null;
  const nextObjects = objects.flatMap((object): SceneObject[] => {
    if (object.id === trimmed.id) {
      const paths = trimmed.paths.map((entry, index) =>
        index === edit.pathIndex ? nextPath : entry,
      );
      return [{ ...trimmed, paths, bounds: boundsForPaths(paths) ?? trimmed.bounds }];
    }
    if (!isPathArtwork(object)) return [object];
    const remaining = withoutConsumed(object, consumed);
    return remaining === null ? [] : [remaining];
  });
  return { objects: nextObjects, joins: result.joins };
}

// Open contours of other objects' paths that cut like the trimmed path and whose ends meet a
// cut point, carried into the trimmed object's local coordinates.
function partnerContours(
  objects: ReadonlyArray<SceneObject>,
  trimmed: PathArtwork,
  inverse: AffineMatrix,
  sameCut: (object: PathArtwork, path: ColoredPath) => boolean,
  touches: (curve: CurveSubpath, object: SceneObject) => boolean,
): { readonly partners: ReadonlyArray<Partner>; readonly foreign: ReadonlyArray<JoinCandidate> } {
  const partners: Partner[] = [];
  const foreign: JoinCandidate[] = [];
  for (const object of objects) {
    if (object.id === trimmed.id || object.locked === true || !isPathArtwork(object)) continue;
    const toLocal = multiplyAffine(inverse, transformAffine(object.transform));
    object.paths.forEach((candidatePath, pathIndex) => {
      if (!sameCut(object, candidatePath)) return;
      contoursOf(candidatePath).forEach((curve, curveIndex) => {
        if (curve.closed || !touches(curve, object)) return;
        const [local] = bakeCurves([curve], toLocal);
        if (local === undefined) return;
        partners.push({ objectId: object.id, pathIndex, curveIndex });
        foreign.push({ curve: local, anchored: false });
      });
    });
  }
  return { partners, foreign };
}

function partnerKey(partner: Partner): string {
  return `${partner.objectId}|${partner.pathIndex}|${partner.curveIndex}`;
}

// The object without the contours a join consumed; null when nothing is left.
function withoutConsumed(object: PathArtwork, consumed: ReadonlySet<string>): PathArtwork | null {
  let changed = false;
  const paths = object.paths.flatMap((path, pathIndex): ColoredPath[] => {
    const keep = (index: number) => !consumed.has(`${object.id}|${pathIndex}|${index}`);
    const polylines = path.polylines.filter((_, index) => keep(index));
    if (polylines.length === path.polylines.length) return [path];
    changed = true;
    if (polylines.length === 0) return [];
    const curves = path.curves?.filter((_, index) => keep(index));
    return [{ ...path, polylines, ...(curves === undefined ? {} : { curves }) }];
  });
  if (!changed) return object;
  if (paths.length === 0) return null;
  return { ...object, paths, bounds: boundsForPaths(paths) ?? object.bounds };
}

/** A copy of the trimmed-away stretch as its own path artwork, or null without one. */
export function preservedStretch(
  project: Project,
  trimmed: SceneObject,
  edit: TrimEdit,
  color: string,
): ImportedSvg | null {
  if (edit.removed === null) return null;
  const flat = flattenCurveSubpath(edit.removed, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flat.kind !== 'ok') return null;
  const paths: ReadonlyArray<ColoredPath> = [
    { color, curves: [edit.removed], polylines: [flat.polyline] },
  ];
  const layer = project.scene.layers.find((candidate) => candidate.color === color);
  return {
    kind: 'imported-svg',
    id: crypto.randomUUID(),
    source: 'Trimmed segment',
    bounds: boundsForPaths(paths) ?? trimmed.bounds,
    transform: trimmed.transform,
    ...(layer === undefined ? {} : { operationIds: [layer.id] }),
    paths,
  };
}
