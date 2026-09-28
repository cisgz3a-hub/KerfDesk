// Fits one run of an outline (between two corners, or a closed contour with
// none) with lines, circular arcs and cubic Béziers for Optimize Shapes
// (LBG-T22). Every piece lies within the tolerance of the run's points, both
// ways: lines and arcs by the arc fitter's exact check (arc-piece-check.ts,
// ADR-432), cubics by the bound in tangent-cubic.ts.
//
// The walk is greedy like the arc fitter's (fit-runs.ts): from the last break
// it tries each kind of piece, finds how far along the run it still fits
// (galloping, then bisecting), and keeps the one covering the most points per
// piece; a tie keeps the simpler kind (line, arc, biarc, cubic). Each piece
// leaves along the tangent the one before it arrived with, so the pieces of a
// run meet smoothly: arcs and cubics exactly, lines within LINE_KINK_DEG. Only
// a run's own ends, which are corners or the ends of an open path, may turn.
// When nothing longer fits, the run's own chord to the next point is used.

import type { Vec2 } from '../../scene/scene-object';
import { primitiveFitsPiece, type ArcFitTolerance } from '../arc-fit/arc-piece-check';
import {
  arcLeavingAlong,
  fitLine,
  primitiveEndTangent,
  unit,
  type FitArc,
  type FitPrimitive,
} from '../arc-fit/arc-primitives';
import { biarcBetween, biarcFitsPiece } from '../arc-fit/biarc';
import { farthestReach } from '../arc-fit/fit-runs';
import { mergeCocircular } from '../arc-fit/merge-cocircular';
import { runTangents } from './run-tangents';
import { fitTangentCubicWithin } from './tangent-cubic';

export type WorldPiece =
  | { readonly kind: 'line'; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly arc: FitArc }
  | {
      readonly kind: 'cubic';
      readonly control1: Vec2;
      readonly control2: Vec2;
      readonly end: Vec2;
    };

/** 'lines' joins points into straight lines only, with no smoothness asked of the joints. */
export type RunFitKinds = 'lines-arcs-curves' | 'lines-arcs' | 'lines';

type Step = {
  readonly end: number;
  readonly pieces: ReadonlyArray<WorldPiece>;
  readonly endTangent: Vec2;
};

type Candidate = { readonly minSpan: number; readonly at: (j: number) => Step | null };

const LINE_KINK_DEG = 2;
const COS_LINE_KINK = Math.cos((LINE_KINK_DEG * Math.PI) / 180);
// Tangents average the points within this many tolerances each side (run-tangents.ts).
const TANGENT_WINDOW_TOLERANCES = 2;

/**
 * `points` runs from its first to its last point; a periodic run (a closed
 * contour without corners) repeats its first point at the end and must leave
 * and arrive along one tangent there.
 */
export function fitRun(
  points: ReadonlyArray<Vec2>,
  periodic: boolean,
  toleranceMm: number,
  kinds: RunFitKinds,
): WorldPiece[] {
  const last = points.length - 1;
  if (last < 1) return [];
  if (last === 1) return [{ kind: 'line', end: points[1] as Vec2 }];
  const tangents =
    kinds === 'lines' ? [] : runTangents(points, periodic, TANGENT_WINDOW_TOLERANCES * toleranceMm);
  const tolerance: ArcFitTolerance = { toleranceMm, exactArcs: true };
  const seam = periodic && kinds !== 'lines' ? (tangents[0] as Vec2) : null;
  const out: WorldPiece[] = [];
  let i = 0;
  let carried: Vec2 | null = seam;
  while (i < last) {
    const context: StepContext = {
      points,
      tangents,
      i,
      last,
      carried,
      seam,
      toleranceMm,
      tolerance,
      kinds,
    };
    const step = bestStep(context);
    out.push(...step.pieces);
    carried = kinds === 'lines' ? null : step.endTangent;
    i = step.end;
  }
  return out;
}

type StepContext = {
  readonly points: ReadonlyArray<Vec2>;
  readonly tangents: ReadonlyArray<Vec2>;
  readonly i: number;
  readonly last: number;
  /** The tangent the previous piece arrived with; null at a corner or open end. */
  readonly carried: Vec2 | null;
  /** A periodic run's seam tangent, which its last piece must arrive with. */
  readonly seam: Vec2 | null;
  readonly toleranceMm: number;
  readonly tolerance: ArcFitTolerance;
  readonly kinds: RunFitKinds;
};

function bestStep(context: StepContext): Step {
  const { points, i } = context;
  const next = points[i + 1] as Vec2;
  let best: Step = {
    end: i + 1,
    pieces: [{ kind: 'line', end: next }],
    endTangent: direction(points[i] as Vec2, next),
  };
  let bestCoverage = 1;
  for (const candidate of candidates(context)) {
    let found: Step | null = null;
    const reach = farthestReach(i, context.last, candidate.minSpan, (j) => {
      const step = candidate.at(j);
      if (step !== null && (found === null || step.end > found.end)) found = step;
      return step !== null;
    });
    const step = found as Step | null;
    if (reach < 0 || step === null || step.end !== reach) continue;
    const coverage = (reach - i) / step.pieces.length;
    if (coverage > bestCoverage) {
      best = step;
      bestCoverage = coverage;
    }
  }
  return best;
}

function candidates(context: StepContext): Candidate[] {
  const line: Candidate = { minSpan: 1, at: (j) => lineStep(context, j) };
  if (context.kinds === 'lines') return [line];
  const arc: Candidate = { minSpan: 2, at: (j) => arcStep(context, j) };
  const biarc: Candidate = { minSpan: 2, at: (j) => biarcStep(context, j) };
  if (context.kinds === 'lines-arcs') return [line, arc, biarc];
  const cubic: Candidate = { minSpan: 2, at: (j) => cubicStep(context, j) };
  return [line, arc, cubic];
}

function lineStep(context: StepContext, j: number): Step | null {
  const { points, i, carried } = context;
  const start = points[i] as Vec2;
  const end = points[j] as Vec2;
  const along = direction(start, end);
  if (context.kinds !== 'lines') {
    if (carried !== null && dot(along, carried) < COS_LINE_KINK) return null;
    const arriving = arrivalTangent(context, j);
    if (j === context.last && context.seam !== null && dot(along, arriving) < COS_LINE_KINK) {
      return null;
    }
  }
  const piece = { points, from: i, to: j };
  if (!primitiveFitsPiece(fitLine(start, end), piece, context.tolerance)) return null;
  return { end: j, pieces: [{ kind: 'line', end }], endTangent: along };
}

function arcStep(context: StepContext, j: number): Step | null {
  const { points, i } = context;
  const arc = arcLeavingAlong(points[i] as Vec2, leavingTangent(context), points[j] as Vec2);
  if (arc === null || arc.kind !== 'arc') return null;
  const endTangent = primitiveEndTangent(arc);
  if (
    j === context.last &&
    context.seam !== null &&
    dot(endTangent, context.seam) < COS_LINE_KINK
  ) {
    return null;
  }
  if (!primitiveFitsPiece(arc, { points, from: i, to: j }, context.tolerance)) return null;
  return { end: j, pieces: [{ kind: 'arc', arc }], endTangent };
}

function biarcStep(context: StepContext, j: number): Step | null {
  const { points, i } = context;
  const arriving = arrivalTangent(context, j);
  const biarc = biarcBetween(
    points[i] as Vec2,
    leavingTangent(context),
    points[j] as Vec2,
    arriving,
  );
  if (biarc === null || !biarcFitsPiece(biarc, points, i, j, context.tolerance)) return null;
  const pieces = mergeCocircular([biarc.first, biarc.second]).map(worldPiece);
  return { end: j, pieces, endTangent: arriving };
}

function cubicStep(context: StepContext, j: number): Step | null {
  const { points, i } = context;
  const arriving = arrivalTangent(context, j);
  const back = { x: -arriving.x, y: -arriving.y };
  const cubic = fitTangentCubicWithin(
    points,
    i,
    j,
    leavingTangent(context),
    back,
    context.toleranceMm,
  );
  if (cubic === null) return null;
  return {
    end: j,
    pieces: [{ kind: 'cubic', control1: cubic.p1, control2: cubic.p2, end: cubic.p3 }],
    endTangent: arriving,
  };
}

function leavingTangent(context: StepContext): Vec2 {
  return context.carried ?? (context.tangents[context.i] as Vec2);
}

function arrivalTangent(context: StepContext, j: number): Vec2 {
  return j === context.last && context.seam !== null ? context.seam : (context.tangents[j] as Vec2);
}

function worldPiece(primitive: FitPrimitive): WorldPiece {
  return primitive.kind === 'line'
    ? { kind: 'line', end: primitive.end }
    : { kind: 'arc', arc: primitive };
}

function direction(from: Vec2, to: Vec2): Vec2 {
  return unit(to.x - from.x, to.y - from.y);
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
