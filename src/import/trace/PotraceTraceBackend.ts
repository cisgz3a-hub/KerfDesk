import type { SubPath } from '../../core/scene/SceneObject';
import type { TraceBitmap } from './TraceBitmap';
import {
  type PotraceTurnPolicy,
  traceBitmapToPotracePaths,
} from './PotracePathScanner';
import {
  adjustPotraceVertices,
  calculateBestPotracePolygon,
  calculatePotraceLongestStraightSegments,
} from './PotracePolygonMath';
import {
  optimizePotraceCurve,
  potraceCurveToPathSegments,
  smoothClosedPolygonToPotraceCurve,
} from './PotraceCurveMath';

export interface PotraceTraceBackendOptions {
  turdsize: number;
  turnpolicy: PotraceTurnPolicy;
  alphamax: number;
  opttolerance: number;
  optcurve: boolean;
}

export function traceBitmapToSubPaths(
  bitmap: TraceBitmap,
  options: PotraceTraceBackendOptions,
): SubPath[] {
  const paths = traceBitmapToPotracePaths(bitmap, {
    turdsize: options.turdsize,
    turnpolicy: options.turnpolicy,
  });
  const subPaths: SubPath[] = [];

  for (const path of paths) {
    const longestStraightSegments = calculatePotraceLongestStraightSegments(path.points);
    const polygon = calculateBestPotracePolygon(path.points, longestStraightSegments);
    let vertices = adjustPotraceVertices(path.points, polygon);
    if (path.sign === '-') {
      vertices = [...vertices].reverse();
    }
    if (vertices.length < 2) continue;

    const curve = smoothClosedPolygonToPotraceCurve(vertices, options.alphamax);
    const optimizedCurve = options.optcurve
      ? optimizePotraceCurve(curve, options.opttolerance)
      : curve;
    subPaths.push({
      segments: potraceCurveToPathSegments(optimizedCurve),
      closed: true,
    });
  }

  return subPaths;
}
