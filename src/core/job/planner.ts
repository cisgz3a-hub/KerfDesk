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
import type { CutGroup, FillGroup, Job, RasterGroup } from './job';
import { rasterDurationMotion } from './raster-duration-motion';
import { offsetForSpeed } from './scan-offset';

const SECONDS_PER_MINUTE = 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };

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
  const travelV =
    Math.max(1, device.controlledLaserOffTravelFeedMmPerMin ?? device.maxFeed) / SECONDS_PER_MINUTE;
  const finishPosition =
    options.finishPosition === undefined
      ? resolveGrblDialect(device).parkAtOriginAfterJob
        ? ORIGIN
        : null
      : options.finishPosition;
  const blocks = buildBlocks(
    job,
    device,
    travelV,
    options.initialPosition ?? ORIGIN,
    finishPosition,
  );
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

// Block decomposition. Walks every cut segment and produces one block
// per polyline edge (cut, full feed), preceded by a one-block travel
// from the previous cursor position. The final travel mirrors the selected
// output dialect (or an explicit current-position finish). Multi-pass repeats
// the cut blocks.
function buildBlocks(
  job: Job,
  device: DeviceProfile,
  travelV: number,
  initialPosition: Vec2,
  finishPosition: Vec2 | null,
): Block[] {
  const out: Block[] = [];
  let cursor: Vec2 = initialPosition;
  for (const group of job.groups) {
    // CNC groups are pre-transformed into XY cut groups by estimate-duration.
    // Raster groups retain their emitted per-power runs so S0 and powered G1
    // legs share one continuous feed-motion chain in the planner.
    if (group.kind === 'cnc') continue;
    const cutV = groupCutVelocity(group, device);
    if (group.kind === 'raster') {
      cursor = appendRasterGroupBlocks(out, cursor, group, cutV, travelV, device);
      continue;
    }
    cursor =
      group.kind === 'fill' && (group.fillStyle ?? 'scanline') !== 'offset'
        ? appendFillGroupBlocks(out, cursor, group, cutV, travelV, device)
        : appendCutGroupBlocks(out, cursor, group, cutV, travelV, device);
  }
  if (finishPosition !== null) appendTravel(out, cursor, finishPosition, travelV);
  return out;
}

function groupCutVelocity(
  group: CutGroup | FillGroup | RasterGroup,
  device: DeviceProfile,
): number {
  return Math.max(1, Math.min(group.speed, device.maxFeed)) / SECONDS_PER_MINUTE;
}

function appendRasterGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: RasterGroup,
  cutV: number,
  travelV: number,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  for (const motion of rasterDurationMotion(group, initialCursor, device.scanningOffsets)) {
    if (motion.kind === 'cut') appendCut(out, motion.from, motion.to, cutV);
    else if (motion.kind === 'feed-travel') {
      appendFeedTravel(out, motion.from, motion.to, cutV);
    } else if (device.controlledLaserOffTravelFeedMmPerMin !== undefined) {
      appendFeedTravel(out, motion.from, motion.to, travelV);
    } else {
      appendTravel(out, motion.from, motion.to, travelV);
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
  travelV: number,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, group.speed);
  const plans = planFillSweeps(group, scanOffsetMm);
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const plan of plans) {
      cursor = appendFillSweepBlocks(out, cursor, plan, cutV, travelV);
    }
  }
  return cursor;
}

function appendFillSweepBlocks(
  out: Block[],
  cursor: Vec2,
  plan: FillSweepPlan,
  cutV: number,
  travelV: number,
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
  appendTravel(out, cursor, run.leadStart, travelV);
  if (plan.leadInMm > 0) {
    appendRunwayBlock(out, run.leadStart, run.burnStart, plan, cutV, travelV);
  }
  for (let spanIndex = 0; spanIndex < sweep.spans.length; spanIndex += 1) {
    const span = sweep.spans[spanIndex];
    if (span === undefined) continue;
    appendCut(out, span.start, span.end, cutV);
    const next = sweep.spans[spanIndex + 1];
    if (next !== undefined) appendFeedTravel(out, span.end, next.start, cutV);
  }
  if (plan.leadOutMm > 0) {
    appendRunwayBlock(out, run.burnEnd, run.leadEnd, plan, cutV, travelV);
  }
  return run.leadEnd;
}

function appendRunwayBlock(
  out: Block[],
  from: Vec2,
  to: Vec2,
  plan: FillSweepPlan,
  cutV: number,
  travelV: number,
): void {
  if (plan.runwayMotion === 'feed-matched') appendFeedTravel(out, from, to, cutV);
  else appendTravel(out, from, to, travelV);
}

function appendCutGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: CutGroup | FillGroup,
  cutV: number,
  travelV: number,
  device: DeviceProfile,
): Vec2 {
  let cursor = initialCursor;
  const entryRunwayMm = group.entryRunwayMm ?? 0;
  const bed = { widthMm: device.bedWidth, heightMm: device.bedHeight };
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const seg of group.segments) {
      const first = seg.polyline[0];
      if (first === undefined) continue;
      // ADR-239: the tangential entry is laser-off feed motion, timed like
      // the emitted `G1 F<feed> S0` ramp rather than a rapid.
      const entry = entryRunwayMm > 0 ? contourEntryPoint(seg.polyline, entryRunwayMm, bed) : null;
      if (entry === null) {
        appendTravel(out, cursor, first, travelV);
      } else {
        appendTravel(out, cursor, entry, travelV);
        appendFeedTravel(out, entry, first, cutV);
      }
      appendCutPolylineBlocks(out, seg.polyline, cutV);
      const last = seg.polyline[seg.polyline.length - 1];
      if (last !== undefined) cursor = last;
    }
  }
  return cursor;
}

function appendCutPolylineBlocks(out: Block[], polyline: ReadonlyArray<Vec2>, cutV: number): void {
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    if (a !== undefined && b !== undefined) appendCut(out, a, b, cutV);
  }
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

function appendCut(out: Block[], from: Vec2, to: Vec2, v: number): void {
  const d = distance(from, to);
  if (d <= 0) return;
  out.push({
    kind: 'cut',
    motion: 'feed',
    distance: d,
    targetVelocity: v,
    direction: unitVector(from, to, d),
  });
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
