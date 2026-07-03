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
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import {
  boundsForPaths,
  isClosedPolygon,
  materializeVectorObject,
  pathDToPolyline,
  polylineToPathD,
  type VectorSceneObject,
} from './vector-path-tools';

export type VectorBooleanOp = 'subtract' | 'intersect' | 'exclude';

const OP_LABEL: Readonly<Record<VectorBooleanOp, string>> = {
  subtract: 'Subtracted paths',
  intersect: 'Intersected paths',
  exclude: 'Excluded paths',
};

const FALLBACK_COLOR = '#000000';
const MIN_OFFSET_MM = 0.001;

/**
 * Combine the bottom-most object (subject) with the rest (clips). Throws when
 * fewer than two objects are given, a contour is open, or the result is empty
 * (e.g. an intersection of disjoint shapes) — callers surface the message.
 */
export function combineVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  op: VectorBooleanOp,
  id: string,
): ImportedSvg {
  const [subjectObject, ...clipObjects] = objects;
  if (subjectObject === undefined || clipObjects.length === 0) {
    throw new Error('Boolean operations need two or more closed vector objects.');
  }
  const subject = closedWorldPaths([subjectObject]);
  const clip = closedWorldPaths(clipObjects);
  const combined = runBooleanOp(op, subject, clip);
  const paths: ColoredPath[] = [
    {
      color: objectColor(subjectObject),
      polylines: combined.map(pathDToPolyline).filter(isClosedPolygon),
    },
  ];
  if ((paths[0]?.polylines.length ?? 0) === 0) {
    throw new Error('The result is empty — the selected shapes do not overlap that way.');
  }
  return resultObject(id, OP_LABEL[op], paths, subjectObject);
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
): ImportedSvg {
  const first = objects[0];
  if (first === undefined) {
    throw new Error('Offset needs at least one closed vector object.');
  }
  if (!Number.isFinite(deltaMm) || Math.abs(deltaMm) < MIN_OFFSET_MM) {
    throw new Error('Offset distance must be a non-zero number of millimeters.');
  }
  const inflated = inflatePathsD(
    closedWorldPaths(objects),
    deltaMm,
    JoinType.Round,
    EndType.Polygon,
  );
  const paths: ColoredPath[] = [
    { color: objectColor(first), polylines: inflated.map(pathDToPolyline).filter(isClosedPolygon) },
  ];
  if ((paths[0]?.polylines.length ?? 0) === 0) {
    throw new Error('The offset collapsed the shape — use a smaller inward distance.');
  }
  return resultObject(id, `Offset paths (${deltaMm > 0 ? '+' : ''}${deltaMm} mm)`, paths, first);
}

function runBooleanOp(op: VectorBooleanOp, subject: PathsD, clip: PathsD): PathsD {
  switch (op) {
    case 'subtract':
      return differenceD(subject, clip, FillRule.NonZero);
    case 'intersect':
      return intersectD(subject, clip, FillRule.NonZero);
    case 'exclude':
      return xorD(subject, clip, FillRule.NonZero);
  }
}

function closedWorldPaths(objects: ReadonlyArray<VectorSceneObject>): PathsD {
  const out: PathsD = [];
  for (const object of objects) {
    const materialized = materializeVectorObject(object);
    for (const path of materialized.paths) {
      for (const polyline of path.polylines) {
        if (!isClosedPolygon(polyline)) {
          throw new Error('Boolean and offset operations need closed contours only.');
        }
        out.push(polylineToPathD(polyline));
      }
    }
  }
  return out;
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
    kind: 'imported-svg',
    id,
    source,
    bounds: boundsForPaths(paths) ?? subject.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}
