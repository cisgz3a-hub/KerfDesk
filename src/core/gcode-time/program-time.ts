// buildProgramTime — planner-true seconds for a parsed program (ADR-255
// stage 8b).
//
// Shares lookahead + trapezoidal kinematics with job duration estimation.
// Inspector supplies its own assumed limits; job timing additionally supplies
// device calibration and layers serial delivery onto this motion clock.
//
// Beyond an honest ETA this yields the planner lens: which moves never
// sustained their programmed feed because acceleration or cornering got in
// the way first — "why is my job slow", answered from the program itself.

import { SEG_MOTION, type GcodeRenderModel, type ProgramEvent } from '../gcode-view';
import { blockTime, planVelocities, type Block, type BlockKind } from '../motion-planner';
import type { PlannedBlock } from '../motion-planner/columnar-plan';
import { blockAcceleration } from '../motion-planner/planner-kinematics';
import { sanitizeLimits, type MotionLimits } from './motion-limits';
import { motionSpans } from './motion-spans';
import { segmentBlocks } from './segment-blocks';
import { validTimeScale, type ProgramTimingOptions } from './program-timing-options';

export type { ProgramTimeCalibration } from './program-timing-options';

export type ProgramMotionBreakdown = {
  readonly cutSeconds: number;
  readonly rapidTravelSeconds: number;
  readonly feedTravelSeconds: number;
};

// "Feed-limited" asks whether the move ever REACHED its programmed feed —
// not whether it took longer than a pure cruise. Every first and last move
// of a program starts or ends at rest, so the cruise comparison flags them
// all and says nothing useful.

export type ProgramTimeModel = {
  /** Seconds for each segment. */
  readonly segSeconds: Float64Array;
  /** Per-segment motion calibration, also used for partial-route time. */
  readonly segTimeScale: Float64Array;
  readonly segDistanceMm: Float32Array;
  readonly segTargetVelocityMmPerSec: Float32Array;
  readonly segEntryVelocityMmPerSec: Float32Array;
  readonly segExitVelocityMmPerSec: Float32Array;
  /** The acceleration each segment was planned at (ADR-675: below
   * accelMmPerSec2 only off the axes of a CoreXY machine). */
  readonly segAccelMmPerSec2: Float64Array;
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
  readonly accelMmPerSec2: number;
  readonly breakdown: ProgramMotionBreakdown;
};

export function buildProgramTime(
  model: GcodeRenderModel,
  rawLimits: MotionLimits,
  options: ProgramTimingOptions = {},
  machineKind?: ProgramTimingOptions['machineKind'],
): ProgramTimeModel {
  const count = model.segmentCount;
  const segSeconds = new Float64Array(count);
  const segTimeScale = new Float64Array(count);
  const segDistanceMm = new Float32Array(count);
  const segTargetVelocityMmPerSec = new Float32Array(count);
  const segEntryVelocityMmPerSec = new Float32Array(count);
  const segExitVelocityMmPerSec = new Float32Array(count);
  const segAccelMmPerSec2 = new Float64Array(count);
  const segTimeEndSec = new Float32Array(count);
  const segFeedLimited = new Uint8Array(count);
  const walked = walkProgramMotion(
    model,
    rawLimits,
    options,
    machineKind,
    (index, block, entry, seconds, scale, accel, elapsed) => {
      segSeconds[index] = seconds;
      segTimeScale[index] = scale;
      segDistanceMm[index] = block.distance;
      segTargetVelocityMmPerSec[index] = block.targetVelocity;
      segEntryVelocityMmPerSec[index] = entry.entryV;
      segExitVelocityMmPerSec[index] = entry.exitV;
      segAccelMmPerSec2[index] = accel;
      segTimeEndSec[index] = elapsed;
      if (!reachesTargetVelocity(block, entry.entryV, entry.exitV, accel)) {
        segFeedLimited[index] = 1;
      }
    },
  );
  return {
    segSeconds,
    segTimeScale,
    segDistanceMm,
    segTargetVelocityMmPerSec,
    segEntryVelocityMmPerSec,
    segExitVelocityMmPerSec,
    segAccelMmPerSec2,
    segTimeEndSec,
    segFeedLimited,
    motionSeconds: walked.motionSeconds,
    dwellSeconds: walked.dwellSeconds,
    totalSeconds: walked.motionSeconds + walked.dwellSeconds,
    accelMmPerSec2: walked.accelMmPerSec2,
    breakdown: walked.breakdown,
  };
}

export type ProgramMotionTotals = {
  readonly motionSeconds: number;
  readonly dwellSeconds: number;
  readonly accelMmPerSec2: number;
  readonly breakdown: ProgramMotionBreakdown;
};

type SegmentVisit = (
  index: number,
  block: Block,
  entry: { readonly entryV: number; readonly exitV: number },
  seconds: number,
  scale: number,
  accel: number,
  elapsed: number,
) => void;

function walkProgramMotion(
  model: GcodeRenderModel,
  rawLimits: MotionLimits,
  options: ProgramTimingOptions,
  machineKind: ProgramTimingOptions['machineKind'],
  visit: SegmentVisit,
): ProgramMotionTotals {
  const limits = sanitizeLimits(rawLimits, options);
  const context = motionContext(options, machineKind);
  const power = model.segPower;
  const kinematics = limits.kinematics ?? 'cartesian';
  const tally = new MotionTally(context);
  for (const span of motionSpans(model, model.segmentCount)) {
    // Blocks are built per span, so no whole-program block array outlives it.
    const spanBlocks = segmentBlocks(model, limits, span.startIndex, span.endIndex);
    const plan = planVelocities(
      spanBlocks,
      limits.accelMmPerSec2,
      limits.junctionDeviationMm,
      context.plannerBlocks,
      kinematics,
    );
    for (let localIndex = 0; localIndex < spanBlocks.length; localIndex += 1) {
      const index = span.startIndex + localIndex;
      const block = spanBlocks[localIndex];
      const entry = plan[localIndex];
      if (block === undefined || entry === undefined) continue;
      const rapid = model.segMotion[index] === SEG_MOTION.rapid;
      const cutting = isCuttingMove(rapid, block.kind, context.machineKind, power[index] ?? 0);
      const accel = blockAcceleration(block, limits.accelMmPerSec2, kinematics);
      const seconds = tally.add(block, entry.entryV, entry.exitV, accel, cutting, rapid);
      const scale = cutting ? context.cutTimeScale : context.travelTimeScale;
      visit(index, block, entry, seconds, scale, accel, tally.elapsed);
    }
  }
  return tally.totals(totalDwellSeconds(model.events), limits.accelMmPerSec2);
}

export type MotionContext = ReturnType<typeof motionContext>;

export function motionContext(
  options: ProgramTimingOptions,
  machineKind: ProgramTimingOptions['machineKind'],
) {
  return {
    machineKind: options.machineKind ?? machineKind,
    cutTimeScale: validTimeScale(options.cutTimeScale ?? options.timeCalibration?.cutTimeScale),
    travelTimeScale: validTimeScale(
      options.travelTimeScale ?? options.timeCalibration?.travelTimeScale,
    ),
    plannerBlocks: options.plannerBlocks,
  };
}

export function isCuttingMove(
  rapid: boolean,
  kind: BlockKind,
  machineKind: ProgramTimingOptions['machineKind'],
  power: number,
): boolean {
  if (rapid) return false;
  return kind === 'cut' && (machineKind !== 'laser' || power > 0);
}

/**
 * Each planned block's scaled seconds, summed in program order. The timeline
 * and the totals-only ETA both add their blocks here, so their totals are the
 * same doubles.
 */
export class MotionTally {
  elapsed = 0;
  private cutSeconds = 0;
  private rapidTravelSeconds = 0;
  private feedTravelSeconds = 0;

  constructor(private readonly context: MotionContext) {}

  /** Adds one block and returns its seconds. */
  add(
    block: PlannedBlock,
    entryV: number,
    exitV: number,
    accel: number,
    cutting: boolean,
    rapid: boolean,
  ): number {
    const scale = cutting ? this.context.cutTimeScale : this.context.travelTimeScale;
    const seconds = blockTime(block, entryV, exitV, accel) * scale;
    if (cutting) this.cutSeconds += seconds;
    else if (rapid) this.rapidTravelSeconds += seconds;
    else this.feedTravelSeconds += seconds;
    this.elapsed += seconds;
    return seconds;
  }

  totals(dwellSeconds: number, accelMmPerSec2: number): ProgramMotionTotals {
    return {
      motionSeconds: this.elapsed,
      dwellSeconds,
      accelMmPerSec2,
      breakdown: {
        cutSeconds: this.cutSeconds,
        rapidTravelSeconds: this.rapidTravelSeconds,
        feedTravelSeconds: this.feedTravelSeconds,
      },
    };
  }
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

export function totalDwellSeconds(events: Iterable<ProgramEvent>): number {
  let total = 0;
  for (const event of events) {
    if (event.kind === 'dwell') total += event.seconds;
  }
  return total;
}
