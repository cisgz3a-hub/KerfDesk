// Laser machining policy for traced vectors (tracer audit Finding 5, ADR-391,
// amending ADR-260's laser pass-through). Every straight segment of a traced
// path becomes one G1 move. Outlines the contour tracer fitted with cubics
// keep those cubics as their curves, which compile flattens at the machine
// curve tolerance. The rest arrive as vertices every ~1.5 trace pixels, so at
// commit those straight-segment subpaths are reduced to the fewest moves
// within the same tolerance, at the placement the store applies. Drawn
// corners, open-chain ends and ring seams keep their exact positions. As on
// CNC, the scene then stores what the machine runs at that placement: a curved
// subpath's compatibility polyline becomes compile's own flattening.
//
// A dense trace has tens of thousands of subpaths, so this runs as resumable
// trace steps: the commit drives them cooperatively and the browser keeps
// painting and taking input between subpaths. Both runners do the same work in
// the same order, so the result does not depend on which one ran it.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Transform,
} from '../../core/scene';
import { carrySubpathNesting } from '../../core/scene/subpath-nesting';
import { simplifyToolpathPolyline, type ToolpathSimplifyOptions } from '../../core/toolpath';
import { runTraceSteps, type TraceSteps } from '../../core/trace/trace-steps';
import { preserveLaserTraceTopologySteps } from './laser-trace-topology';

// The tree-wide hard-corner convention, as in the CNC fairing: the sharpener,
// curve refinement and dense corner detection all pin at 60 degrees.
const LASER_TRACE_CORNER_ANGLE_DEG = 60;

type LaserMoves = {
  readonly simplify: ToolpathSimplifyOptions;
  /** The local-unit flattening tolerance compile applies at this placement,
   *  or null when the placement has no usable scale. */
  readonly curveTolerance: number | null;
};

type Subpath = { readonly curve: CurveSubpath; readonly polyline: Polyline };

/** Condition a laser trace at its placement scale: straight-segment subpaths
 *  become the fewest moves within the tolerance, curved subpaths keep their
 *  curves. A path whose curves do not pair with its polylines is left as it
 *  is. */
export function simplifyTracedPathsForLaser(
  paths: ReadonlyArray<ColoredPath>,
  placement: Transform,
): ColoredPath[] {
  return runTraceSteps(simplifyTracedPathsForLaserSteps(paths, placement));
}

/** simplifyTracedPathsForLaser as resumable steps, a checkpoint per subpath. */
export function* simplifyTracedPathsForLaserSteps(
  paths: ReadonlyArray<ColoredPath>,
  placement: Transform,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const scaleX = Math.abs(placement.scaleX);
  const scaleY = Math.abs(placement.scaleY);
  // Compile bounds curve deviation with the largest axis scale.
  const largestScale = Math.max(scaleX, scaleY);
  const moves: LaserMoves = {
    simplify: {
      mmPerUnitX: scaleX,
      mmPerUnitY: scaleY,
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      cornerAngleDeg: LASER_TRACE_CORNER_ANGLE_DEG,
    },
    curveTolerance:
      Number.isFinite(largestScale) && largestScale > 0
        ? DEFAULT_MACHINE_CURVE_TOLERANCE_MM / largestScale
        : null,
  };
  const candidates: ColoredPath[] = [];
  for (const path of paths) candidates.push(yield* conditionPathSteps(path, moves, cooperate));
  // The topology check keeps every crossing and nesting relation of the
  // source, subpath for subpath, so a traced forest (ADR-531) carries.
  const preserved = yield* preserveLaserTraceTopologySteps(paths, candidates, placement);
  const carried: ColoredPath[] = [];
  for (const [index, path] of preserved.entries()) {
    if (cooperate) yield;
    const source = paths[index] as ColoredPath;
    carried.push(path === source ? path : carrySubpathNesting(source, path));
  }
  return carried;
}

function* conditionPathSteps(
  path: ColoredPath,
  moves: LaserMoves,
  cooperate: boolean,
): TraceSteps<ColoredPath> {
  const curves = path.curves;
  if (curves === undefined) {
    // Compile reads the polylines of a path without curves.
    const polylines: Polyline[] = [];
    for (const polyline of path.polylines) {
      if (cooperate) yield;
      polylines.push(simplifyToolpathPolyline(polyline, moves.simplify));
    }
    return polylines.every((polyline, index) => polyline === path.polylines[index])
      ? path
      : { ...path, polylines };
  }
  if (curves.length !== path.polylines.length) return path;
  let changed = false;
  const polylines: Polyline[] = [];
  const nextCurves: CurveSubpath[] = [];
  for (const [index, curve] of curves.entries()) {
    if (cooperate) yield;
    const conditioned = conditionSubpath(curve, moves);
    if (conditioned === null) {
      polylines.push(path.polylines[index] as Polyline);
      nextCurves.push(curve);
      continue;
    }
    changed = true;
    polylines.push(conditioned.polyline);
    nextCurves.push(conditioned.curve);
  }
  return changed ? { ...path, polylines, curves: nextCurves } : path;
}

// The canonical curve is what compile flattens. A straight-only curve is
// simplified from its own vertices and rebuilt from the result; a curved one
// stays as it is and its compatibility polyline becomes the chords compile
// emits. Null when nothing changes.
function conditionSubpath(curve: CurveSubpath, moves: LaserMoves): Subpath | null {
  if (curve.segments.every((segment) => segment.kind === 'line')) {
    const vertices: Polyline = {
      points: [curve.start, ...curve.segments.map((segment) => segment.to)],
      closed: curve.closed,
    };
    const simplified = simplifyToolpathPolyline(vertices, moves.simplify);
    return simplified === vertices
      ? null
      : { curve: polylineToCurveSubpath(simplified), polyline: simplified };
  }
  if (moves.curveTolerance === null) return null;
  const flattened = flattenCurveSubpath(curve, { toleranceMm: moves.curveTolerance });
  return flattened.kind === 'ok' ? { curve, polyline: flattened.polyline } : null;
}
