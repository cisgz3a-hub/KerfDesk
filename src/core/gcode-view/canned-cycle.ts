// Canned drilling cycles expanded into ordinary moves (ADR-255 stage 12).
//
// G81/G82/G83/G73 each stand for a whole sequence of moves — position, go to
// the R plane, feed down (pecking if asked), retract. Without expanding them
// a drilling program renders its rapids and NOTHING where the holes are,
// which is the most misleading thing a viewer can do: it looks complete.
//
// Semantics follow LinuxCNC's canned-cycle definitions. Note that GRBL v1.1
// does NOT implement these cycles (its supported set stops at G80), so a
// program using them will not run as-is on a GRBL controller — Program
// Health reports that separately. We still draw them, because the Inspector
// reads programs from any CAM, not only ones this machine can run.

export const CANNED_CYCLES = [73, 81, 82, 83] as const;
export type CannedCycle = (typeof CANNED_CYCLES)[number];

/** G98 retracts to the Z the cycle started from; G99 to the R plane. */
export type RetractMode = 98 | 99;

export type CyclePoint = { readonly x: number; readonly y: number; readonly z: number };

export type CycleMove = {
  readonly to: CyclePoint;
  /** Rapid positioning versus a cutting feed move. */
  readonly rapid: boolean;
};

export type CycleRequest = {
  readonly cycle: CannedCycle;
  readonly retract: RetractMode;
  /** Hole position and final depth, already resolved to absolute mm. */
  readonly target: CyclePoint;
  /** R plane in absolute mm. */
  readonly rPlane: number;
  /** Peck increment for G83/G73; ignored otherwise. */
  readonly peck: number | null;
  /** Where the tool was before the cycle ran. */
  readonly from: CyclePoint;
  /** Z the cycle started from — the G98 retract height. */
  readonly initialZ: number;
};

/** Chip-break lift for G73. LinuxCNC leaves it machine-defined; a small
 * fixed lift renders the motion honestly without inventing a parameter. */
const CHIP_BREAK_LIFT_MM = 0.5;
const MIN_PECK_MM = 0.01;

/**
 * The moves one canned-cycle hole expands into, in order. Pure: the caller
 * pushes them as ordinary segments, so pecks and retracts colour, time and
 * scrub exactly like hand-written motion.
 */
export function expandCannedCycle(request: CycleRequest): ReadonlyArray<CycleMove> {
  const { target, rPlane, from, initialZ } = request;
  const moves: CycleMove[] = [];
  const clearance = Math.max(rPlane, initialZ);
  // Lift clear before traversing, exactly as a controller would.
  if (from.z < clearance) moves.push({ to: { x: from.x, y: from.y, z: clearance }, rapid: true });
  moves.push({ to: { x: target.x, y: target.y, z: clearance }, rapid: true });
  moves.push({ to: { x: target.x, y: target.y, z: rPlane }, rapid: true });
  for (const move of drillMoves(request)) moves.push(move);
  const retractZ = request.retract === 98 ? initialZ : rPlane;
  moves.push({ to: { x: target.x, y: target.y, z: retractZ }, rapid: true });
  return moves;
}

function drillMoves(request: CycleRequest): ReadonlyArray<CycleMove> {
  const { cycle, target, rPlane, peck } = request;
  const xy = { x: target.x, y: target.y };
  // G81/G82 plunge straight to depth; G82's dwell is an event, not motion.
  if (cycle === 81 || cycle === 82 || peck === null || peck < MIN_PECK_MM) {
    return [{ to: { ...xy, z: target.z }, rapid: false }];
  }
  const moves: CycleMove[] = [];
  let depth = rPlane;
  while (depth > target.z) {
    depth = Math.max(target.z, depth - peck);
    moves.push({ to: { ...xy, z: depth }, rapid: false });
    if (depth <= target.z) break;
    // G83 fully retracts to clear chips; G73 lifts just enough to break them.
    const lift = cycle === 83 ? rPlane : Math.min(rPlane, depth + CHIP_BREAK_LIFT_MM);
    moves.push({ to: { ...xy, z: lift }, rapid: true });
    // Rapid back down to just above the last cut before feeding again.
    if (cycle === 83) moves.push({ to: { ...xy, z: depth }, rapid: true });
  }
  return moves;
}
