// pen-path-edit — rebuild a path object after the pen extends, closes or
// absorbs one of its subpaths (ADR-380). Only edited subpaths are flattened
// again; every other subpath keeps its stored geometry untouched.

import {
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type SceneObject,
} from '../../core/scene';
import { CURRENT_POLYLINE_FAIRING_VERSION } from '../../core/shapes';
import { flattenPenCurve } from '../../core/shapes/pen-path';
import { curveAnchors, pathSubpathCurves } from '../workspace/pen-snap-geometry';

export type PenJoinableObject = Extract<
  SceneObject,
  { readonly kind: 'shape' | 'imported-svg' | 'traced-image' }
>;

export type PenSubpathEdit = {
  readonly pathIndex: number;
  readonly curveIndex: number;
  // Replacement geometry in object-local millimetres; null removes the subpath.
  readonly curve: CurveSubpath | null;
};

/**
 * The object with the edits applied, null when nothing of it is left, or
 * undefined when an edited curve cannot be flattened (the scene is then left
 * alone rather than half-edited).
 */
export function editPathObjectSubpaths(
  object: PenJoinableObject,
  edits: ReadonlyArray<PenSubpathEdit>,
): PenJoinableObject | null | undefined {
  const paths: ColoredPath[] = [];
  for (const [pathIndex, path] of object.paths.entries()) {
    const pathEdits = edits.filter((edit) => edit.pathIndex === pathIndex);
    if (pathEdits.length === 0) {
      paths.push(path);
      continue;
    }
    const edited = editPath(path, pathEdits);
    if (edited === undefined) return undefined;
    if (edited !== null) paths.push(edited);
  }
  return paths.length === 0 ? null : withPaths(object, paths);
}

function editPath(
  path: ColoredPath,
  edits: ReadonlyArray<PenSubpathEdit>,
): ColoredPath | null | undefined {
  const source = pathSubpathCurves(path);
  // Stored polylines are reused only when they line up one-to-one with the
  // curves; anything else is flattened again so the two views cannot drift.
  const aligned = path.polylines.length === source.length;
  const curves: CurveSubpath[] = [];
  const polylines: Polyline[] = [];
  for (const [curveIndex, original] of source.entries()) {
    const edit = edits.find((candidate) => candidate.curveIndex === curveIndex);
    const curve = edit === undefined ? original : edit.curve;
    if (curve === null) continue;
    const stored = edit === undefined && aligned ? path.polylines[curveIndex] : undefined;
    const polyline = stored ?? flattenPenCurve(curve);
    if (polyline === null) return undefined;
    curves.push(curve);
    polylines.push(polyline);
  }
  return curves.length === 0 ? null : { ...path, curves, polylines };
}

function withPaths(
  object: PenJoinableObject,
  paths: ReadonlyArray<ColoredPath>,
): PenJoinableObject {
  const bounds = pathsBounds(paths);
  if (object.kind !== 'shape') return { ...object, paths, bounds };
  // A pen drawing's spec mirrors its first subpath's nodes, and the fairing
  // stamp keeps the legacy smoothing migration from refitting the edit.
  const first = paths[0]?.curves?.[0];
  return {
    ...object,
    paths,
    bounds,
    ...(first === undefined
      ? {}
      : { spec: { kind: 'polyline', points: [...curveAnchors(first)], closed: first.closed } }),
    fairingVersion: Math.max(object.fairingVersion ?? 0, CURRENT_POLYLINE_FAIRING_VERSION),
  };
}

// Loops rather than Math.min(...spread): a traced path can hold more points
// than a spread argument list allows.
function pathsBounds(paths: ReadonlyArray<ColoredPath>): Bounds {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (next: Bounds): void => {
    box.minX = Math.min(box.minX, next.minX);
    box.minY = Math.min(box.minY, next.minY);
    box.maxX = Math.max(box.maxX, next.maxX);
    box.maxY = Math.max(box.maxY, next.maxY);
  };
  for (const path of paths) {
    if (path.curves !== undefined)
      path.curves.forEach((curve) => include(curveSubpathBounds(curve)));
    else path.polylines.forEach((polyline) => polyline.points.forEach((p) => include(pointBox(p))));
  }
  return Number.isFinite(box.minX) ? box : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function pointBox(point: { readonly x: number; readonly y: number }): Bounds {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}
