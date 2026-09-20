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

import { SEG_MOTION, type GcodeRenderModel } from '../gcode-view';
import { blockTime, planVelocities, type Block } from '../motion-planner';
import { sanitizeLimits, type MotionLimits } from './motion-limits';
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
  const limits = sanitizeLimits(rawLimits);
  const context = motionContext(options, machineKind);
  const blocks = segmentBlocks(model, limits);
  const power = model.segPower;
  const segSeconds = new Float64Array(blocks.length);
  const segTimeScale = new Float64Array(blocks.length);
  const segDistanceMm = new Float32Array(blocks.length);
  const segTargetVelocityMmPerSec = new Float32Array(blocks.length);
  const segEntryVelocityMmPerSec = new Float32Array(blocks.length);
  const segExitVelocityMmPerSec = new Float32Array(blocks.length);
  const segTimeEndSec = new Float32Array(blocks.length);
  const segFeedLimited = new Uint8Array(blocks.length);
  let elapsed = 0;
  let cutSeconds = 0;
  let rapidTravelSeconds = 0;
  let feedTravelSeconds = 0;
  for (const span of motionSpans(model, blocks.length)) {
    const spanBlocks = blocks.slice(span.startIndex, span.endIndex);
    const plan = planVelocities(spanBlocks, limits.accelMmPerSec2, limits.junctionDeviationMm);
    for (let localIndex = 0; localIndex < spanBlocks.length; localIndex += 1) {
      const index = span.startIndex + localIndex;
      const block = spanBlocks[localIndex];
      const entry = plan[localIndex];
      if (block === undefined || entry === undefined) continue;
      const rapid = model.segMotion[index] === SEG_MOTION.rapid;
      const cutting = isCutting(model, index, block, context.machineKind, power);
      const scale = cutting ? context.cutTimeScale : context.travelTimeScale;
      const seconds = blockTime(block, entry.entryV, entry.exitV, limits.accelMmPerSec2) * scale;
      if (cutting) cutSeconds += seconds;
      else if (rapid) rapidTravelSeconds += seconds;
      else feedTravelSeconds += seconds;
      segSeconds[index] = seconds;
      segTimeScale[index] = scale;
      segDistanceMm[index] = block.distance;
      segTargetVelocityMmPerSec[index] = block.targetVelocity;
      segEntryVelocityMmPerSec[index] = entry.entryV;
      segExitVelocityMmPerSec[index] = entry.exitV;
      elapsed += seconds;
      segTimeEndSec[index] = elapsed;
      if (!reachesTargetVelocity(block, entry.entryV, entry.exitV, limits.accelMmPerSec2)) {
        segFeedLimited[index] = 1;
      }
    }
  }
  const dwellSeconds = totalDwellSeconds(model);
  return {
    segSeconds,
    segTimeScale,
    segDistanceMm,
    segTargetVelocityMmPerSec,
    segEntryVelocityMmPerSec,
    segExitVelocityMmPerSec,
    segTimeEndSec,
    segFeedLimited,
    motionSeconds: elapsed,
    dwellSeconds,
    totalSeconds: elapsed + dwellSeconds,
    accelMmPerSec2: limits.accelMmPerSec2,
    breakdown: { cutSeconds, rapidTravelSeconds, feedTravelSeconds },
  };
}

type MotionSpan = { readonly startIndex: number; readonly endIndex: number };

function motionContext(
  options: ProgramTimingOptions,
  machineKind: ProgramTimingOptions['machineKind'],
) {
  return {
    machineKind: options.machineKind ?? machineKind,
    cutTimeScale: validTimeScale(options.cutTimeScale ?? options.timeCalibration?.cutTimeScale),
    travelTimeScale: validTimeScale(
      options.travelTimeScale ?? options.timeCalibration?.travelTimeScale,
    ),
  };
}

function isCutting(
  model: GcodeRenderModel,
  index: number,
  block: Block,
  machineKind: ProgramTimingOptions['machineKind'],
  power: Float32Array,
): boolean {
  if (model.segMotion[index] === SEG_MOTION.rapid) return false;
  return block.kind === 'cut' && (machineKind !== 'laser' || (power[index] ?? 0) > 0);
}
type SynchronizationBoundary = { readonly line: number; readonly isBeforeMotion: boolean };

function motionSpans(model: GcodeRenderModel, segmentCount: number): ReadonlyArray<MotionSpan> {
  const spans: MotionSpan[] = [];
  let startIndex = 0;
  for (const boundary of synchronizationBoundaries(model)) {
    let endIndex = startIndex;
    while (
      endIndex < segmentCount &&
      segmentPrecedesBoundary(model.segLine[endIndex] ?? 0, boundary)
    ) {
      endIndex += 1;
    }
    if (endIndex > startIndex) spans.push({ startIndex, endIndex });
    startIndex = endIndex;
  }
  if (startIndex < segmentCount) spans.push({ startIndex, endIndex: segmentCount });
  return spans;
}

function synchronizationBoundaries(
  model: GcodeRenderModel,
): ReadonlyArray<SynchronizationBoundary> {
  const boundaries = new Map<number, boolean>();
  for (const event of model.events) {
    if (event.kind === 'dwell' || event.kind === 'pause') {
      if (!boundaries.has(event.line)) boundaries.set(event.line, false);
      continue;
    }
    if (event.kind !== 'synchronization') continue;
    boundaries.set(event.line, (boundaries.get(event.line) ?? false) || event.isBeforeMotion);
  }
  return [...boundaries]
    .map(([line, isBeforeMotion]) => ({ line, isBeforeMotion }))
    .sort((left, right) => left.line - right.line);
}

function segmentPrecedesBoundary(segmentLine: number, boundary: SynchronizationBoundary): boolean {
  return boundary.isBeforeMotion ? segmentLine < boundary.line : segmentLine <= boundary.line;
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
