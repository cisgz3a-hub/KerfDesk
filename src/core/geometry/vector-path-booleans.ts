// Boolean combine (subtract / intersect / exclude) and path offsetting for
// selected vector objects (ADR-103 G1). Sibling to vector-path-tools.ts,
// which owns Weld (= union) — these ops need a subject/clip split, so they
// live apart from the color-grouped union.
//
// Subject convention (PROVISIONAL, ADR-103): the BOTTOM-MOST selected object
// in z-order is the subject; every other selected object is a clip. Matches
// the "cut the front shapes out of the back shape" reading of Subtract. The
// result inherits the subject's color and lands as a plain path object with
// identity transform (world-space baked), exactly like Weld.

import { differenceD, FillRule, inflatePathsD, intersectD, xorD, type PathsD } from 'clipper2-ts';
import { EndType, JoinType } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import {
  boundsForPaths,
  pathDToPolyline,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';
import { canonicalizeVectorPaths, compareCanonicalVectorPaths } from './vector-path-canonical';
import {
  normalizeVectorObjectRegion,
  unionNormalizedRegions,
  VECTOR_PATH_PRECISION_DECIMALS,
} from './vector-path-regions';

export type VectorBooleanOp = 'subtract' | 'intersect' | 'exclude';

const OP_LABEL: Readonly<Record<VectorBooleanOp, string>> = {
  subtract: 'Subtracted paths',
  intersect: 'Intersected paths',
  exclude: 'Excluded paths',
};

const FALLBACK_COLOR = '#000000';
const MIN_OFFSET_MM = 0.001;

/**
 * Combine the bottom-most object (subject) with the rest (clips). Returns an
 * error result when fewer than two objects are given, a contour is open, or the
 * result is empty (e.g. an intersection of disjoint shapes) — callers surface
 * the message as a toast.
 */
export function combineVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
  id: string,
): Result<ImportedSvg, VectorOpError> {
  const [subjectObject, ...clipObjects] = objects;
  if (subjectObject === undefined || clipObjects.length === 0) {
    return err({
      kind: 'too-few-objects',
      message: 'Boolean operations need two or more closed vector objects.',
    });
  }
  const subject = normalizeVectorObjectRegion(subjectObject);
  if (subject.kind === 'error') return subject;
  const clipRegions = clipObjects.map(normalizeVectorObjectRegion);
  const clipError = clipRegions.find((region) => region.kind === 'error');
  if (clipError?.kind === 'error') return clipError;
  const combined = runBooleanOp(
    op,
    subject.value,
    clipRegions.flatMap((region) => (region.kind === 'ok' ? [region.value] : [])),
  );
  if (combined.kind === 'error') return combined;
  const paths: ColoredPath[] = [
    {
      color: objectColor(subjectObject),
      polylines: combined.value.map(pathDToPolyline),
    },
  ];
  if ((paths[0]?.polylines.length ?? 0) === 0) {
    return err({
      kind: 'empty-result',
      message: 'The result is empty — the selected shapes do not overlap that way.',
    });
  }
  return ok(resultObject(id, OP_LABEL[op], paths, subjectObject));
}

/**
 * Offset every closed contour of the selection by `deltaMm` (positive =
 * outward, negative = inward), round joins. The offset shape is a NEW object;
 * the sources stay (VCarve/LightBurn offset-tool convention).
 */
export function offsetVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  deltaMm: number,
  id: string,
): Result<ImportedSvg, VectorOpError> {
  const first = objects[0];
  if (first === undefined) {
    return err({
      kind: 'too-few-objects',
      message: 'Offset needs at least one closed vector object.',
    });
  }
  if (!Number.isFinite(deltaMm) || Math.abs(deltaMm) < MIN_OFFSET_MM) {
    return err({
      kind: 'bad-distance',
      message: 'Offset distance must be a non-zero number of millimeters.',
    });
  }
  const regions = objects.map(normalizeVectorObjectRegion);
  const regionError = regions.find((region) => region.kind === 'error');
  if (regionError?.kind === 'error') return regionError;
  const world = unionNormalizedRegions(
    regions.flatMap((region) => (region.kind === 'ok' ? [region.value] : [])),
  );
  if (world.kind === 'error') return world;
  const inflated = tryVectorOp(() =>
    canonicalizeVectorPaths(
      inflatePathsD(
        world.value,
        deltaMm,
        JoinType.Round,
        EndType.Polygon,
        2,
        VECTOR_PATH_PRECISION_DECIMALS,
      ),
    ),
  );
  if (inflated.kind === 'error') return inflated;
  const paths: ColoredPath[] = [
    {
      color: objectColor(first),
      polylines: inflated.value.map(pathDToPolyline),
    },
  ];
  if ((paths[0]?.polylines.length ?? 0) === 0) {
    return err({
      kind: 'collapsed',
      message: 'The offset collapsed the shape — use a smaller inward distance.',
    });
  }
  return ok(
    resultObject(id, `Offset paths (${deltaMm > 0 ? '+' : ''}${deltaMm} mm)`, paths, first),
  );
}

function runBooleanOp(
  op: VectorBooleanOp,
  subject: PathsD,
  clips: ReadonlyArray<PathsD>,
): Result<PathsD, VectorOpError> {
  if (op === 'subtract') {
    const clip = unionNormalizedRegions(clips);
    if (clip.kind === 'error') return clip;
    return tryVectorOp(() =>
      canonicalizeVectorPaths(
        differenceD(subject, clip.value, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
      ),
    );
  }
  return tryVectorOp(() => {
    const ordered = [subject, ...clips].sort(compareCanonicalVectorPaths);
    let combined: PathsD = ordered[0] ?? [];
    for (const clip of ordered.slice(1)) {
      combined =
        op === 'intersect'
          ? intersectD(combined, clip, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS)
          : xorD(combined, clip, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS);
    }
    return canonicalizeVectorPaths(combined);
  });
}

function objectColor(object: VectorSceneObject): string {
  return object.paths[0]?.color ?? FALLBACK_COLOR;
}

function resultObject(
  id: string,
  source: string,
  paths: ReadonlyArray<ColoredPath>,
  subject: VectorSceneObject,
): ImportedSvg {
  return {
    ...(subject.powerScale === undefined ? {} : { powerScale: subject.powerScale }),
    ...(subject.operationOverride === undefined
      ? {}
      : { operationOverride: subject.operationOverride }),
    kind: 'imported-svg',
    id,
    source,
    bounds: boundsForPaths(paths) ?? subject.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}
