// buildProgramTime — planner-true seconds for a parsed program (ADR-255
// stage 8b).
//
// Runs the SAME lookahead + trapezoidal kinematics the job duration
// estimator uses (core/motion-planner), so the Inspector's clock and the
// Job Review estimate cannot drift apart by construction.
//
// Beyond an honest ETA this yields the planner lens: which moves never
// sustained their programmed feed because acceleration or cornering got in
// the way first — "why is my job slow", answered from the program itself.

import type { GcodeRenderModel } from '../gcode-view';
import { blockTime, planVelocities, type Block } from '../motion-planner';
import { sanitizeLimits, type MotionLimits } from './motion-limits';
import { segmentBlocks } from './segment-blocks';

// "Feed-limited" asks whether the move ever REACHED its programmed feed —
// not whether it took longer than a pure cruise. Every first and last move
// of a program starts or ends at rest, so the cruise comparison flags them
// all and says nothing useful.

export type ProgramTimeModel = {
  /** Seconds for each segment. */
  readonly segSeconds: Float32Array;
  /** Cumulative seconds at each segment's end. */
  readonly segTimeEndSec: Float32Array;
  /** 1 where the move never sustained its programmed feed. */
  readonly segFeedLimited: Uint8Array;
  /** Motion time only. */
  readonly motionSeconds: number;
  /** Total G4 dwell time in the program. */
  readonly dwellSeconds: number;
  /** motionSeconds + dwellSeconds — the ETA. */
  readonly totalSeconds: number;
};

export function buildProgramTime(
  model: GcodeRenderModel,
  rawLimits: MotionLimits,
): ProgramTimeModel {
  const limits = sanitizeLimits(rawLimits);
  const blocks = segmentBlocks(model, limits);
  const plan = planVelocities(blocks, limits.accelMmPerSec2, limits.junctionDeviationMm);
  const segSeconds = new Float32Array(blocks.length);
  const segTimeEndSec = new Float32Array(blocks.length);
  const segFeedLimited = new Uint8Array(blocks.length);
  let elapsed = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const entry = plan[index];
    if (block === undefined || entry === undefined) continue;
    const seconds = blockTime(block, entry.entryV, entry.exitV, limits.accelMmPerSec2);
    segSeconds[index] = seconds;
    elapsed += seconds;
    segTimeEndSec[index] = elapsed;
    if (!reachesTargetVelocity(block, entry.entryV, entry.exitV, limits.accelMmPerSec2)) {
      segFeedLimited[index] = 1;
    }
  }
  const dwellSeconds = totalDwellSeconds(model);
  return {
    segSeconds,
    segTimeEndSec,
    segFeedLimited,
    motionSeconds: elapsed,
    dwellSeconds,
    totalSeconds: elapsed + dwellSeconds,
  };
}

// Trapezoid test: the move reaches its target only if there is room to
// accelerate up to it and still decelerate to the planned exit.
function reachesTargetVelocity(
  block: Block,
  entryV: number,
  exitV: number,
  accel: number,
): boolean {
  if (block.distance <= 0 || block.targetVelocity <= 0) return true;
  const target = block.targetVelocity;
  const rampUp = Math.max(0, (target * target - entryV * entryV) / (2 * accel));
  const rampDown = Math.max(0, (target * target - exitV * exitV) / (2 * accel));
  return rampUp + rampDown <= block.distance;
}

function totalDwellSeconds(model: GcodeRenderModel): number {
  let total = 0;
  for (const event of model.events) {
    if (event.kind === 'dwell') total += event.seconds;
  }
  return total;
}
