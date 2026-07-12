import { polylineToCurveSubpath, type ColoredPath } from '../scene';

export function withCanonicalTraceCurves(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.map((path) => ({
    ...path,
    curves: path.curves ?? path.polylines.map(polylineToCurveSubpath),
  }));
}
