// Fits one canonical subpath with line and circular-arc moves in machine
// millimetres (ADR-407). The moves start where the subpath starts and end
// where it ends; every corner the subpath has (a joint turning more than the
// smooth-joint angle between curves, or at least the corner angle between
// lines) is a move end at its exact mapped position. What the controller
// executes for each move stays within the tolerance of the canonical curve,
// both ways, after the budget in arc-fit-limits.ts.

import type { CurveSubpath } from '../../scene';
import { ARC_FIT_EMIT_ROUNDING_MM, ARC_FIT_SOURCE_SAMPLE_ERROR_MM } from './arc-fit-limits';
import type { FitPrimitive } from './arc-primitives';
import type { ArcMove } from './arc-moves';
import { splitIntoFitRuns } from './curve-runs';
import { fitSmoothRun, fitStraightRun } from './fit-runs';
import { mapCurveSubpath, type ArcFitPlacement } from './mapped-pieces';

export function fitArcMoves(
  curve: CurveSubpath,
  placement: ArcFitPlacement,
  toleranceMm: number,
): ArcMove[] {
  const fitTolerance = toleranceMm - ARC_FIT_SOURCE_SAMPLE_ERROR_MM - ARC_FIT_EMIT_ROUNDING_MM;
  const moves: ArcMove[] = [];
  for (const run of splitIntoFitRuns(mapCurveSubpath(curve, placement))) {
    const primitives =
      run.kind === 'smooth'
        ? fitSmoothRun(run.run, fitTolerance)
        : fitStraightRun(run.vertices, fitTolerance);
    for (const primitive of primitives) moves.push(moveOf(primitive));
  }
  return moves;
}

function moveOf(primitive: FitPrimitive): ArcMove {
  return primitive.kind === 'line'
    ? { kind: 'line', to: primitive.end }
    : {
        kind: 'arc',
        to: primitive.end,
        center: primitive.center,
        clockwise: primitive.clockwise,
      };
}
