import type { MotionBlock, MotionManifest, MotionPoint } from './motion-manifest';

export type RouteCandidate = {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly routeMm: number;
  readonly distanceMm: number;
};

export type RouteReconciliationState = {
  readonly confirmedRouteMm: number;
  readonly candidates: ReadonlyArray<RouteCandidate>;
  readonly uncertain: boolean;
};

export type RouteReconciliationInput = {
  readonly manifest: MotionManifest;
  readonly previous: RouteReconciliationState;
  readonly reportedPosition: MotionPoint;
  /** Acknowledged lines are an upper bound only; they never advance progress. */
  readonly acceptedSendableLines: number;
  readonly executingLineNumber?: number | null;
  readonly toleranceMm?: number;
};

const DEFAULT_TOLERANCE_MM = 1.5;
const BACKTRACK_ALLOWANCE_MM = 0.2;
const MAX_CANDIDATES = 64;

export const INITIAL_ROUTE_RECONCILIATION: RouteReconciliationState = {
  confirmedRouteMm: 0,
  candidates: [],
  uncertain: false,
};

export function reconcileReportedPosition(
  input: RouteReconciliationInput,
): RouteReconciliationState {
  const tolerance = input.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  const candidates: RouteCandidate[] = [];
  const lineCeiling = acceptedLineCeiling(input);
  const hasProgramLineNumbers = input.manifest.blocks.some(
    (block) => block.programLineNumber !== null,
  );
  for (const [blockIndex, block] of input.manifest.blocks.entries()) {
    if (!blockMayBeExecuting(block, lineCeiling, hasProgramLineNumbers, input)) continue;
    collectBlockCandidates(
      block,
      blockIndex,
      input.reportedPosition,
      input.previous.confirmedRouteMm,
      tolerance,
      candidates,
    );
  }
  candidates.sort((a, b) => a.routeMm - b.routeMm || a.distanceMm - b.distanceMm);
  const feasible = candidates.slice(0, MAX_CANDIDATES);
  if (feasible.length === 0) return { ...input.previous, candidates: [], uncertain: true };
  return {
    confirmedRouteMm: Math.max(input.previous.confirmedRouteMm, feasible[0]?.routeMm ?? 0),
    candidates: feasible,
    uncertain: false,
  };
}

function blockMayBeExecuting(
  block: MotionBlock,
  lineCeiling: number,
  hasProgramLineNumbers: boolean,
  input: RouteReconciliationInput,
): boolean {
  if (block.sendableLineIndex > lineCeiling) return false;
  if (!hasProgramLineNumbers || input.executingLineNumber == null) return true;
  if (input.executingLineNumber <= 0 || block.programLineNumber === null) return true;
  return block.programLineNumber <= input.executingLineNumber;
}

function acceptedLineCeiling(input: RouteReconciliationInput): number {
  return Math.max(-1, input.acceptedSendableLines - 1);
}

function collectBlockCandidates(
  block: MotionBlock,
  blockIndex: number,
  position: MotionPoint,
  confirmedRouteMm: number,
  toleranceMm: number,
  output: RouteCandidate[],
): void {
  let blockDistance = 0;
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1];
    const to = block.points[index];
    if (from === undefined || to === undefined) continue;
    const projection = projectToSegment(position, from, to);
    const segmentLength = distance(from, to);
    const routeMm = block.routeStartMm + blockDistance + projection.t * segmentLength;
    blockDistance += segmentLength;
    if (routeMm + BACKTRACK_ALLOWANCE_MM < confirmedRouteMm) continue;
    if (projection.distanceMm > toleranceMm) continue;
    output.push({
      blockIndex,
      segmentIndex: index - 1,
      routeMm,
      distanceMm: projection.distanceMm,
    });
  }
}

function projectToSegment(
  point: MotionPoint,
  from: MotionPoint,
  to: MotionPoint,
): { readonly t: number; readonly distanceMm: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const denominator = dx * dx + dy * dy + dz * dz;
  const raw =
    denominator <= Number.EPSILON
      ? 0
      : ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / denominator;
  const t = Math.max(0, Math.min(1, raw));
  return {
    t,
    distanceMm: Math.hypot(
      point.x - (from.x + dx * t),
      point.y - (from.y + dy * t),
      point.z - (from.z + dz * t),
    ),
  };
}

function distance(a: MotionPoint, b: MotionPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
