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
  /**
   * Acknowledged lines bound where the head can be: nothing past them has
   * reached the planner, and nothing more than one execution window before
   * them is still in it. They never advance progress on their own; only a
   * positional match does.
   */
  readonly acceptedSendableLines: number;
  readonly executingLineNumber?: number | null;
  readonly toleranceMm?: number;
};

const DEFAULT_TOLERANCE_MM = 1.5;
const BACKTRACK_ALLOWANCE_MM = 0.2;
const MAX_CANDIDATES = 64;
const lineNumberPresenceCache = new WeakMap<MotionManifest, boolean>();

/**
 * Most motion blocks that can separate the block the controller is executing
 * from the last acknowledged line. An `ok` means the line was parsed into the
 * planner, so only planner-resident blocks can still be moving: GRBL 1.1 holds
 * 16 and grblHAL 100 by default (`$398`, raisable). The sender never learns
 * the real depth, and firmware also acks lines that take no planner slot
 * (sub-step moves, error replies), so this errs far above both. Too small would
 * skip the executing block and confirm route the head has not reached. Too
 * large costs scan time while the match is frozen, and lets matched progress
 * trail the head further in dense rasters, where rows within tolerance of the
 * head but thousands of blocks behind it still match.
 */
export const EXECUTION_WINDOW_BLOCKS = 4096;

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
  const blocks = input.manifest.blocks;
  const lineCeiling = acceptedLineCeiling(input);
  const hasProgramLineNumbers = manifestHasProgramLineNumbers(input.manifest);
  const endIndex = firstBlockIndexWhere(blocks, (block) => block.sendableLineIndex > lineCeiling);
  const startIndex = scanStartIndex(blocks, endIndex, input.previous.confirmedRouteMm);
  for (let blockIndex = startIndex; blockIndex < endIndex; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block === undefined) continue;
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

function manifestHasProgramLineNumbers(manifest: MotionManifest): boolean {
  const cached = lineNumberPresenceCache.get(manifest);
  if (cached !== undefined) return cached;
  const present = manifest.blocks.some((block) => block.programLineNumber !== null);
  lineNumberPresenceCache.set(manifest, present);
  return present;
}

// Scanning starts at confirmed progress, but never further back than one
// execution window. An uncertain match freezes confirmed progress, so without
// the window every status report would rescan from the frozen point to the
// ceiling, a scan that grows with job time. Blocks older than the window have
// left the planner, so the head cannot be on them.
function scanStartIndex(
  blocks: MotionManifest['blocks'],
  endIndex: number,
  confirmedRouteMm: number,
): number {
  const routeFloorMm = confirmedRouteMm - BACKTRACK_ALLOWANCE_MM;
  return Math.max(
    endIndex - EXECUTION_WINDOW_BLOCKS,
    firstBlockIndexWhere(blocks, (block) => block.routeEndMm >= routeFloorMm),
  );
}

// Blocks are in stream order with at most one block per streamed line, so both
// sendableLineIndex and routeEndMm rise monotonically and a predicate on either
// flips false → true exactly once.
function firstBlockIndexWhere(
  blocks: MotionManifest['blocks'],
  isAtOrPast: (block: MotionBlock) => boolean,
): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = blocks[middle];
    if (block !== undefined && isAtOrPast(block)) high = middle;
    else low = middle + 1;
  }
  return low;
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
    // Scalars, not a projection object: this runs per segment on every status
    // report, inside the store update.
    const t = projectionParameter(position, from, to);
    const segmentLength = distance(from, to);
    const routeMm = block.routeStartMm + blockDistance + t * segmentLength;
    blockDistance += segmentLength;
    if (routeMm + BACKTRACK_ALLOWANCE_MM < confirmedRouteMm) continue;
    const distanceMm = distanceToProjection(position, from, to, t);
    if (distanceMm > toleranceMm) continue;
    output.push({ blockIndex, segmentIndex: index - 1, routeMm, distanceMm });
  }
}

function projectionParameter(point: MotionPoint, from: MotionPoint, to: MotionPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const denominator = dx * dx + dy * dy + dz * dz;
  if (denominator <= Number.EPSILON) return 0;
  const raw =
    ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / denominator;
  return Math.max(0, Math.min(1, raw));
}

function distanceToProjection(
  point: MotionPoint,
  from: MotionPoint,
  to: MotionPoint,
  t: number,
): number {
  return Math.hypot(
    point.x - (from.x + (to.x - from.x) * t),
    point.y - (from.y + (to.y - from.y) * t),
    point.z - (from.z + (to.z - from.z) * t),
  );
}

function distance(a: MotionPoint, b: MotionPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
