// planner — accel + junction-deviation aware time estimation.
//
// Implements Sonny Jeon's grbl motion-planner algorithm (public-domain
// math; no source copied from grbl/grbl-sim which are GPL-3, or from
// any other proprietary implementation). Three pieces:
//
//   1. Block decomposition — every G-code segment between two vertices
//      becomes one Block. A 100-vertex polyline is 100 blocks, not one.
//      This is the entire reason the L1 trapezoidal estimator was still
//      undercounting: real GRBL slows at every direction change.
//
//   2. Junction velocity — at each vertex where the direction changes
//      by angle θ, the cornering velocity is capped at
//        v_j = √( a · δ · sin(θ/2) / (1 − sin(θ/2)) )
//      where δ is the user's $11 junction-deviation setting.
//      0° turn  (straight) → unlimited (capped at v_target)
//      180° turn (reversal) → must stop (v_j = 0)
//
//   3. Two-pass lookahead — each block gets compatible entry/exit
//      velocities:
//        backward pass: from end to start, ensure decel from entry to
//          exit is physically possible (v_entry² ≤ v_exit² + 2·a·d)
//        forward pass:  from start to end, ensure accel from prev exit
//          to this exit is physically possible
//      The result is a velocity profile every block can actually run.
//
// Per-block time follows from the resulting (v_entry, v_exit, v_target,
// distance, accel) tuple using a generalized trapezoid: accel from
// v_entry up to v_peak, optional cruise at v_peak, decel to v_exit.
// When v_peak < v_target the block is "triangular" (never reaches
// target). When the peak the block can sustain is below max(v_entry,
// v_exit) the move is decel-only or accel-only.
//
// Pure-core compliant: no clock, no random, no I/O.

import { resolveGrblDialect, type DeviceProfile } from '../devices';
import {
  blockMotion,
  blockTime,
  junctionVelocity,
  planVelocities,
  type Block,
} from '../motion-planner';
import type { Vec2 } from '../scene';
import { contourEntryPoint } from './contour-entry';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps, type FillSweepPlan } from './fill-sweep-plan';
import type { CutGroup, CutSegment, FillGroup, Job, RasterGroup } from './job';
import { rasterDurationMotion } from './raster-duration-motion';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import { formatGcodeCoordinateMm } from '../gcode';
import { offsetForEmittedFeed } from './scan-offset';
import {
  appendPlannerStop,
  beginLaserPlannerGroup,
  initialLaserPlannerState,
} from './planner-laser-transitions';

const SECONDS_PER_MINUTE = 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };

type SeekMotion = { readonly velocity: number; readonly motion: 'rapid' | 'feed' };

export type PlannedDuration = {
  readonly totalSeconds: number;
  readonly breakdown: {
    readonly cutSeconds: number;
    readonly travelSeconds: number;
    readonly rapidTravelSeconds: number;
    readonly feedTravelSeconds: number;
  };
};

export type PlannerEndMotionOptions = {
  /** Trusted physical head position at program start. Defaults to work zero for
   * export/general estimates that have no live placement evidence. */
  readonly initialPosition?: Vec2;
  readonly finishPosition?: Vec2 | null;
};

export function estimateWithPlanner(
  job: Job,
  device: DeviceProfile,
  options: PlannerEndMotionOptions = {},
): PlannedDuration {
  const accel = Math.max(1, device.accelMmPerSec2);
  const jd = Math.max(0, device.junctionDeviationMm);
  const seek = seekMotion(device);
  const finishPosition =
    options.finishPosition === undefined
      ? resolveGrblDialect(device).parkAtOriginAfterJob
        ? ORIGIN
        : null
      : options.finishPosition;
  const blocks = buildBlocks(job, device, seek, options.initialPosition ?? ORIGIN, finishPosition);
  if (blocks.length === 0) {
    return {
      totalSeconds: 0,
      breakdown: {
        cutSeconds: 0,
        travelSeconds: 0,
        rapidTravelSeconds: 0,
        feedTravelSeconds: 0,
      },
    };
  }
  const plan = planVelocities(blocks, accel, jd);
  let cutSeconds = 0;
  let rapidTravelSeconds = 0;
  let feedTravelSeconds = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const p = plan[i];
    if (block === undefined || p === undefined) continue;
    const t = blockTime(block, p.entryV, p.exitV, accel);
    if (block.kind === 'cut') cutSeconds += t;
    else if (blockMotion(block) === 'feed') feedTravelSeconds += t;
    else rapidTravelSeconds += t;
  }
  const travelSeconds = rapidTravelSeconds + feedTravelSeconds;
  return {
    totalSeconds: cutSeconds + travelSeconds,
    breakdown: { cutSeconds, travelSeconds, rapidTravelSeconds, feedTravelSeconds },
  };
}

function seekMotion(device: DeviceProfile): SeekMotion {
  return {
    velocity:
      effectiveGcodeFeedMmPerMin(device.controlledLaserOffTravelFeedMmPerMin ?? device.maxFeed) /
      SECONDS_PER_MINUTE,
    motion: device.controlledLaserOffTravelFeedMmPerMin === undefined ? 'rapid' : 'feed',
  };
}

// Block decomposition. Walks every cut segment and produces one block
// per polyline edge (cut, full feed), preceded by a one-block travel
// from the previous cursor position. The final travel mirrors the selected
// output dialect (or an explicit current-position finish). Multi-pass repeats
// the cut blocks.
function buildBlocks(
  job: Job,
  device: DeviceProfile,
  seek: SeekMotion,
  initialPosition: Vec2,
  finishPosition: Vec2 | null,
): Block[] {
  const out: Block[] = [];
  const laserState = initialLaserPlannerState(device);
  let cursor: Vec2 = initialPosition;
  for (const group of job.groups) {
    // CNC groups are pre-transformed into XY cut groups by estimate-duration.
    // Raster groups retain their emitted per-power runs so S0 and powered G1
    // legs share one continuous feed-motion chain in the planner.
    if (group.kind === 'cnc') continue;
    if (group.kind === 'cut' && group.plannerStopBefore === true) appendPlannerStop(out);
    beginLaserPlannerGroup(out, group, device, laserState);
    const cutV = groupCutVelocity(group, device);
    if (group.kind === 'raster') {
      cursor = appendRasterGroupBlocks(out, cursor, group, cutV, seek, device);
      appendPlannerStop(out);
      continue;
    }
    cursor =
      group.kind === 'fill' && (group.fillStyle ?? 'scanline') !== 'offset'
        ? appendFillGroupBlocks(out, cursor, group, cutV, seek, device)
        : appendCutGroupBlocks(out, cursor, group, cutV, seek, device);
  }
  // M5 (and any coolant stop) drains motion before the postamble seek, even
  // when that seek uses the same G1 feed and direction as the final burn.
  appendPlannerStop(out);
  if (finishPosition !== null) appendSeek(out, cursor, finishPosition, seek);
  return out;
}

function groupCutVelocity(
  group: CutGroup | FillGroup | RasterGroup,
  device: DeviceProfile,
): number {
  return effectiveGcodeFeedMmPerMin(Math.min(group.speed, device.maxFeed)) / SECONDS_PER_MINUTE;
}

function appendRasterGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: RasterGroup,
  cutV: number,
  seek: SeekMotion,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  for (const motion of rasterDurationMotion(group, initialCursor, device.scanningOffsets)) {
    if (motion.kind === 'cut') appendCut(out, motion.from, motion.to, cutV);
    else if (motion.kind === 'feed-travel') {
      appendFeedTravel(out, motion.from, motion.to, cutV);
    } else {
      appendSeek(out, motion.from, motion.to, seek);
    }
    cursor = motion.to;
  }
  return cursor;
}

function appendFillGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: FillGroup,
  cutV: number,
  seek: SeekMotion,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForEmittedFeed(device.scanningOffsets, group.speed);
  const plans = planFillSweeps(group, scanOffsetMm);
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const plan of plans) {
      cursor = appendFillSweepBlocks(out, cursor, plan, cutV, seek, hasLaserPower(group, device));
    }
  }
  return cursor;
}

function appendFillSweepBlocks(
  out: Block[],
  cursor: Vec2,
  plan: FillSweepPlan,
  cutV: number,
  seek: SeekMotion,
  powered: boolean,
): Vec2 {
  const sweep = plan.sweep;
  const first = sweep.spans[0];
  const last = sweep.spans[sweep.spans.length - 1];
  if (first === undefined || last === undefined) return cursor;
  // The emitted scanline is one continuous G1 chain across powered spans
  // and S0-blanked gaps (ADR-034). Separate the timing buckets while every
  // G1 leg stays in feed motion, so changing S never invents a planner stop.
  const run = expandFillHatchWithRunways([first.start, last.end], plan);
  if (run === null) return cursor;
  appendSeek(out, cursor, run.leadStart, seek);
  if (plan.leadInMm > 0) {
    appendRunwayBlock(out, run.leadStart, run.burnStart, plan, cutV, seek);
  }
  for (let spanIndex = 0; spanIndex < sweep.spans.length; spanIndex += 1) {
    const span = sweep.spans[spanIndex];
    if (span === undefined) continue;
    appendCut(out, span.start, span.end, cutV, powered);
    const next = sweep.spans[spanIndex + 1];
    if (next !== undefined) appendFeedTravel(out, span.end, next.start, cutV);
  }
  if (plan.leadOutMm > 0) {
    appendRunwayBlock(out, run.burnEnd, run.leadEnd, plan, cutV, seek);
  }
  return run.leadEnd;
}

function appendRunwayBlock(
  out: Block[],
  from: Vec2,
  to: Vec2,
  plan: FillSweepPlan,
  cutV: number,
  seek: SeekMotion,
): void {
  if (plan.runwayMotion === 'feed-matched') appendFeedTravel(out, from, to, cutV);
  else appendSeek(out, from, to, seek);
}

function appendCutGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: CutGroup | FillGroup,
  cutV: number,
  seek: SeekMotion,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  const entryRunwayMm = group.entryRunwayMm ?? 0;
  const bed = { widthMm: device.bedWidth, heightMm: device.bedHeight };
  for (let pass = 0; pass < group.passes; pass += 1) {
    // Ordinary vector passes re-arm with standalone M3/M4 S0. Clearing a
    // powered final move is a real planner drain, unlike S0 carried on G1.
    if (rearmsPoweredVectorPass(group, pass, out)) {
      appendPlannerStop(out);
    }
    for (const seg of group.segments) {
      const first = seg.polyline[0];
      if (first === undefined || !hasEmittedSegmentMotion(seg)) continue;
      // ADR-239: the tangential entry is laser-off feed motion, timed like
      // the emitted `G1 F<feed> S0` ramp rather than a rapid.
      const entry = entryRunwayMm > 0 ? contourEntryPoint(seg.polyline, entryRunwayMm, bed) : null;
      if (entry === null) {
        appendSeek(out, cursor, first, seek);
      } else {
        appendSeek(out, cursor, entry, seek);
        appendFeedTravel(out, entry, first, cutV);
      }
      appendCutSegmentBlocks(out, seg, cutV, hasLaserPower(group, device));
      const last = seg.polyline[seg.polyline.length - 1];
      if (last !== undefined) cursor = last;
    }
  }
  return cursor;
}

function rearmsPoweredVectorPass(group: CutGroup | FillGroup, pass: number, out: Block[]): boolean {
  return group.kind === 'cut' && pass > 0 && out.at(-1)?.kind === 'cut';
}

function appendCutSegmentBlocks(
  out: Block[],
  segment: CutSegment,
  cutV: number,
  powered: boolean,
): void {
  if (segment.plannerMotion !== undefined && segment.polyline.length === 2) {
    appendPlannedCut(out, segment.plannerMotion, cutV, powered);
    return;
  }
  for (let i = 1; i < segment.polyline.length; i += 1) {
    const a = segment.polyline[i - 1];
    const b = segment.polyline[i];
    if (a !== undefined && b !== undefined) appendCut(out, a, b, cutV, powered);
  }
}

function appendPlannedCut(
  out: Block[],
  motion: NonNullable<CutSegment['plannerMotion']>,
  v: number,
  powered: boolean,
): void {
  if (!(motion.distanceMm > 0)) return;
  out.push({
    kind: powered ? 'cut' : 'travel',
    motion: 'feed',
    distance: motion.distanceMm,
    targetVelocity: v,
    direction: motion.direction,
  });
}

function appendTravel(out: Block[], from: Vec2, to: Vec2, v: number): void {
  const d = distance(from, to);
  if (d <= 0) return;
  out.push({
    kind: 'travel',
    motion: 'rapid',
    distance: d,
    targetVelocity: v,
    direction: unitVector(from, to, d),
  });
}

function appendSeek(out: Block[], from: Vec2, to: Vec2, seek: SeekMotion): void {
  if (seek.motion === 'feed') appendFeedTravel(out, from, to, seek.velocity);
  else appendTravel(out, from, to, seek.velocity);
}

function appendFeedTravel(out: Block[], from: Vec2, to: Vec2, v: number): void {
  const d = distance(from, to);
  if (d <= 0) return;
  out.push({
    kind: 'travel',
    motion: 'feed',
    distance: d,
    targetVelocity: v,
    direction: unitVector(from, to, d),
  });
}

function appendCut(out: Block[], from: Vec2, to: Vec2, v: number, powered = true): void {
  const d = distance(from, to);
  if (d <= 0) return;
  out.push({
    kind: powered ? 'cut' : 'travel',
    motion: 'feed',
    distance: d,
    targetVelocity: v,
    direction: unitVector(from, to, d),
  });
}

function hasLaserPower(group: CutGroup | FillGroup, device: DeviceProfile): boolean {
  return Math.round((group.power / 100) * device.maxPowerS) > 0;
}

function hasEmittedSegmentMotion(segment: CutSegment): boolean {
  if (segment.plannerCoordinatesRepresented === true) return segment.polyline.length >= 2;
  if ((segment.plannerMotion?.distanceMm ?? 0) > 0) return true;
  const first = segment.polyline[0];
  if (first === undefined) return false;
  const firstX = formatGcodeCoordinateMm(first.x);
  const firstY = formatGcodeCoordinateMm(first.y);
  return segment.polyline.some(
    (point) =>
      formatGcodeCoordinateMm(point.x) !== firstX || formatGcodeCoordinateMm(point.y) !== firstY,
  );
}

function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function unitVector(from: Vec2, to: Vec2, length: number): Vec2 {
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

// Compatibility note: a future per-group export could expose Block[]
// for visualization (preview G-code velocity profile). Out of scope
// for the estimator itself.
// Kinematics now live in core/motion-planner; re-exported so existing
// white-box planner tests keep importing them from here.
export { blockTime, junctionVelocity, planVelocities };
export type { Block, CutGroup, FillGroup };
