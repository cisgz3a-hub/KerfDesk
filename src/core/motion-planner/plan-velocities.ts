// Two-pass lookahead velocity planning (extracted from core/job/planner.ts,
// ADR-255 stage 8a — pure move, no behavior change).

import type { Block } from './block';
import { junctionVelocity } from './junction';

export type PlanEntry = { entryV: number; exitV: number };

// Two-pass lookahead. Sets entry/exit velocities per block such that
// physics holds (accel/decel reachable) AND cornering doesn't exceed
// junction-deviation limits. Exported for white-box invariant tests
// (alongside junctionVelocity/blockTime).
//
// `plannerBlocks` is how many blocks the controller's planner holds, counting
// the one executing (ADR-525). Without it the whole span is planned at once,
// as if the controller could see every later move.
export function planVelocities(
  blocks: ReadonlyArray<Block>,
  accel: number,
  jd: number,
  plannerBlocks?: number,
): PlanEntry[] {
  const plan: PlanEntry[] = blocks.map(() => ({ entryV: 0, exitV: 0 }));
  capJunctionEntries(blocks, plan, accel, jd);
  if (isPlannerWindow(plannerBlocks)) capPlannerWindowEntries(blocks, plan, accel, plannerBlocks);
  backwardPass(blocks, plan, accel);
  forwardPass(blocks, plan, accel);
  return plan;
}

function isPlannerWindow(plannerBlocks: number | undefined): plannerBlocks is number {
  return plannerBlocks !== undefined && Number.isInteger(plannerBlocks) && plannerBlocks >= 1;
}

// A streaming controller plans only the blocks in its buffer, and it always
// plans the newest one to end at rest (GRBL planner.c, planner_recalculate),
// so the machine can stop by the end of whatever it holds. A block's entry
// speed is the exit of the block before it, which is still executing and
// still takes one of the slots, so the entry must be able to fall to zero
// within the block itself and the next plannerBlocks - 2. On short moves,
// such as raster pixels, this cap is the one that sets the speed.
function capPlannerWindowEntries(
  blocks: ReadonlyArray<Block>,
  plan: PlanEntry[],
  accel: number,
  plannerBlocks: number,
): void {
  const stoppingBlocks = plannerBlocks - 1;
  const distanceBefore = new Float64Array(blocks.length + 1);
  for (let i = 0; i < blocks.length; i += 1) {
    distanceBefore[i + 1] = (distanceBefore[i] ?? 0) + (blocks[i]?.distance ?? 0);
  }
  for (let i = 1; i < blocks.length; i += 1) {
    const p = plan[i];
    if (p === undefined) continue;
    const windowEnd = Math.min(blocks.length, i + stoppingBlocks);
    const roomMm = Math.max(0, (distanceBefore[windowEnd] ?? 0) - (distanceBefore[i] ?? 0));
    p.entryV = Math.min(p.entryV, Math.sqrt(2 * accel * roomMm));
  }
}

// Tentative junction-cap entry velocities (max corner speed entering
// each block based on the previous block's direction). First block
// enters from rest (no previous block).
function capJunctionEntries(
  blocks: ReadonlyArray<Block>,
  plan: PlanEntry[],
  accel: number,
  jd: number,
): void {
  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const next = blocks[i];
    const p = plan[i];
    if (prev === undefined || next === undefined || p === undefined) continue;
    const vJunction = junctionVelocity(prev, next, accel, jd);
    // Clamp to BOTH adjacent blocks' target speeds (GRBL mins the junction
    // against both nominal speeds). Omitting prev.targetVelocity let the slower
    // block inherit an exitV above its own target via backwardPass, which made
    // blockTime's tDecel negative and shaved time off the estimate.
    p.entryV = Math.min(prev.targetVelocity, next.targetVelocity, vJunction);
  }
}

// Backward pass: ensure each entry is reachable by decel from exit.
// Last block exits to rest (postamble decel to zero).
function backwardPass(blocks: ReadonlyArray<Block>, plan: PlanEntry[], accel: number): void {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    const p = plan[i];
    if (block === undefined || p === undefined) continue;
    const exit = i === blocks.length - 1 ? 0 : (plan[i + 1]?.entryV ?? 0);
    p.exitV = exit;
    const maxEntry = Math.sqrt(exit * exit + 2 * accel * block.distance);
    p.entryV = Math.min(p.entryV, maxEntry);
  }
}

// Forward pass: ensure each exit is reachable by accel from entry.
function forwardPass(blocks: ReadonlyArray<Block>, plan: PlanEntry[], accel: number): void {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const p = plan[i];
    if (block === undefined || p === undefined) continue;
    const entry = i === 0 ? 0 : (plan[i - 1]?.exitV ?? 0);
    p.entryV = Math.min(p.entryV, entry, block.targetVelocity);
    const maxExit = Math.sqrt(p.entryV ** 2 + 2 * accel * block.distance);
    // Also bound exit by this block's own target so blockTime's decel leg can
    // never go negative (belt-and-suspenders alongside the capJunctionEntries fix).
    p.exitV = Math.min(p.exitV, maxExit, block.targetVelocity);
  }
}
