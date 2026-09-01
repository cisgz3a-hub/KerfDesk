import type { ColoredPath, Polyline } from '../../core/scene';

/** Replaces compatibility geometry while invalidating only its stale canonical curves. */
export function replaceCompatibilityPolylines(
  path: ColoredPath,
  polylines: ReadonlyArray<Polyline>,
): ColoredPath {
  const { curves: _staleCurves, ...pathWithoutCurves } = path;
  return { ...pathWithoutCurves, polylines };
}
