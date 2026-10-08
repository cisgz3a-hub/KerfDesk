import type { Bounds, ColoredPath, ImportedSvg } from '../scene/scene-object';
import { polylineToCurveSubpath } from '../scene/curve-path';
import { sameRecipeValue } from '../material-library/process-recipe';
import type { ConstrainedSketch2d, SketchSolveResult } from './constrained-sketch';
import { solveConstrainedSketch } from './solve-constrained-sketch';
import { sketchPathGeometry, sketchPathKeys } from './sketch-path-geometry';
import { retainedSketchPaths, type RetainedSketchPaths } from './retained-sketch-paths';
import { sketchAt } from './sketch-indexed';
export { sketchPathKeys } from './sketch-path-geometry';
export function materializeConstrainedSketch(
  sketch: ConstrainedSketch2d,
  color: string,
  previous?: ImportedSvg,
): {
  readonly result: SketchSolveResult;
  readonly paths?: readonly ColoredPath[];
  readonly bounds?: Bounds;
  readonly previousPathKeys?: readonly string[];
} {
  const result = solveConstrainedSketch(sketch);
  if (result.kind !== 'solved' || result.status === 'over-constrained') return { result };
  const geometry = sketchPathGeometry(result.sketch, color);
  const keys = sketchPathKeys(result.sketch);
  const retained = retainedSketchPaths(previous);
  if (retained.kind === 'invalid') return { result: retained };
  const paths = geometry.map((path, index) =>
    retainSketchPath(path, sketchAt(keys, index), retained.value, previous),
  );
  const positions = paths.flatMap((path) => path.polylines.flatMap((polyline) => polyline.points));
  if (positions.length === 0)
    return {
      result: { kind: 'invalid', reason: 'The sketch has no line, profile or circle output.' },
    };
  const bounds = {
    minX: Math.min(...positions.map((point) => point.x)),
    minY: Math.min(...positions.map((point) => point.y)),
    maxX: Math.max(...positions.map((point) => point.x)),
    maxY: Math.max(...positions.map((point) => point.y)),
  };
  return { result, paths, bounds, previousPathKeys: retained.value.currentKeys };
}
function retainSketchPath(
  path: ColoredPath,
  key: string,
  retained: RetainedSketchPaths,
  previous: ImportedSvg | undefined,
): ColoredPath {
  const old = retained.settings.get(key);
  if (old === undefined)
    return {
      ...path,
      ...(previous?.operationIds === undefined ? {} : { operationIds: previous.operationIds }),
    };
  const { subpathNesting: _derived, ...settings } = old;
  return {
    ...settings,
    ...path,
    color: old.color,
    ...(old.operationIds === undefined ? {} : { operationIds: old.operationIds }),
  };
}
export function sketchGeometryMatches(object: ImportedSvg): boolean {
  if (object.constrainedSketch === undefined) return true;
  const built = materializeConstrainedSketch(
    object.constrainedSketch,
    object.paths[0]?.color ?? '',
  );
  if (built.paths === undefined || built.paths.length !== object.paths.length) return false;
  return built.paths.every((path, index) => {
    const old = object.paths[index];
    return (
      old !== undefined &&
      sameRecipeValue(path.curves, old.curves ?? old.polylines.map(polylineToCurveSubpath))
    );
  });
}
