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
import type { Vec2 } from '../scene';
import { contourEntryPoint } from './contour-entry';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps, type FillSweepPlan } from './fill-sweep-plan';
import type { CutGroup, FillGroup, Job, RasterGroup } from './job';
import { rasterDurationMotion } from './raster-duration-motion';
import { offsetForSpeed, shiftedScanSweepEndpoints } from './scan-offset';

const SECONDS_PER_MINUTE = 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };

type BlockKind = 'cut' | 'travel';
type BlockMotion = 'rapid' | 'feed';

type Block = {
  readonly kind: BlockKind;
  // Timing/accounting and kinematic continuity are independent. A G1/S0
  // runway is travel for the operator-facing breakdown but feed motion for
  // junction planning, so it must blend into the following powered G1.
  readonly motion?: BlockMotion;
  readonly distance: number; // mm
  readonly targetVelocity: number; // mm/sec
  /** Legacy narrow tag for a continuous S0/burn chain without motion metadata. */
  readonly feedMatchedLaserMotion?: boolean;
  // Unit direction vector. Travels with zero length are filtered out
  // before block creation so this is always defined for real blocks.
  readonly direction: Vec2;
};

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
  const plans = planFillSweeps(group);
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, group.speed);
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const plan of plans) {
      cursor = appendFillSweepBlocks(
        out,
        cursor,
        fillPlanWithScanOffset(plan, scanOffsetMm),
        cutV,
        travelV,
      );
    }
  }
  return cursor;
}

function fillPlanWithScanOffset(plan: FillSweepPlan, scanOffsetMm: number): FillSweepPlan {
  if (!plan.sweep.reverse || scanOffsetMm === 0) return plan;
  const spans = plan.sweep.spans.map((span) => {
    const shifted = shiftedScanSweepEndpoints(span, span, true, scanOffsetMm);
    return { start: shifted.start, end: shifted.end };
  });
  return { ...plan, sweep: { ...plan.sweep, spans } };
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

type PlanEntry = { entryV: number; exitV: number };

// Two-pass lookahead. Sets entry/exit velocities per block such that
// physics holds (accel/decel reachable) AND cornering doesn't exceed
// junction-deviation limits. Exported for white-box invariant tests
// (alongside junctionVelocity/blockTime).
export function planVelocities(
  blocks: ReadonlyArray<Block>,
  accel: number,
  jd: number,
): PlanEntry[] {
  const plan: PlanEntry[] = blocks.map(() => ({ entryV: 0, exitV: 0 }));
  capJunctionEntries(blocks, plan, accel, jd);
  backwardPass(blocks, plan, accel);
  forwardPass(blocks, plan, accel);
  return plan;
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

// Sonny Jeon's junction-deviation formula. θ is the angle between the
// previous block's direction and the next block's direction.
// sin(θ/2) is computed from the dot product without an explicit acos.
export function junctionVelocity(prev: Block, next: Block, accel: number, jd: number): number {
  // Rapid and feed motion retain the estimator's conservative stop boundary.
  // Laser state is not a motion boundary: G1/S0 feed travel blends through a
  // powered G1 span exactly as the emitted continuous sweep does.
  if (blockMotion(prev) !== blockMotion(next) && !isContinuousFeedMatchedLaserJunction(prev, next))
    return 0;
  const cosTheta = prev.direction.x * next.direction.x + prev.direction.y * next.direction.y;
  // Clamp to handle float noise just outside [-1, 1].
  const clamped = Math.min(1, Math.max(-1, cosTheta));
  // Sonny Jeon's junction-deviation half-angle. θ is the DEVIATION angle
  // (0 = straight, π = reversal); GRBL derives sin(θ/2) from the NEGATED
  // dot product, so sin(θ/2) = √((1 + cosTheta) / 2) with cosTheta = prev·next:
  //   straight (cosTheta = +1) → sin = 1 → v_j → ∞ (caller mins against target)
  //   reversal (cosTheta = −1) → sin = 0 → v_j = 0 (must stop)
  // The √((1 − cosTheta)/2) form is inverted: it collapses to ~0 velocity on
  // gentle turns and BLOWS UP toward ∞ on near-reversals, so float noise that
  // nudged a 180° corner off exactly −1 removed the required full stop.
  const sinHalf = Math.sqrt((1 + clamped) / 2);
  if (sinHalf >= 1) return Number.POSITIVE_INFINITY; // straight
  if (sinHalf <= 0) return 0; // reversal
  return Math.sqrt((accel * jd * sinHalf) / (1 - sinHalf));
}

function isContinuousFeedMatchedLaserJunction(prev: Block, next: Block): boolean {
  return (
    prev.feedMatchedLaserMotion === true &&
    next.feedMatchedLaserMotion === true &&
    prev.targetVelocity === next.targetVelocity
  );
}

// Generalized trapezoidal time from v_entry through optional v_peak
// to v_exit over a given distance, capped at v_target.
export function blockTime(block: Block, entryV: number, exitV: number, accel: number): number {
  const d = block.distance;
  if (d <= 0) return 0;
  const vTarget = block.targetVelocity;
  // Distance needed to accel from entryV to vTarget then decel to exitV.
  const dAccel = Math.max(0, (vTarget * vTarget - entryV * entryV) / (2 * accel));
  const dDecel = Math.max(0, (vTarget * vTarget - exitV * exitV) / (2 * accel));
  if (dAccel + dDecel <= d) {
    // Trapezoid: hits vTarget, optional cruise.
    const tAccel = (vTarget - entryV) / accel;
    const tDecel = (vTarget - exitV) / accel;
    const tCruise = (d - dAccel - dDecel) / vTarget;
    return tAccel + tCruise + tDecel;
  }
  // Triangle: never reaches vTarget. Find the peak velocity v_peak that
  // satisfies: dAccel(entry→peak) + dDecel(peak→exit) = d.
  // Solving: v_peak² = (entry² + exit²)/2 + a·d
  const vPeakSq = (entryV * entryV + exitV * exitV) / 2 + accel * d;
  const vPeak = Math.sqrt(Math.max(0, vPeakSq));
  // If the math says peak < max(entry, exit), the move is decel-only
  // or accel-only — entry and exit can't both be satisfied at this
  // distance with this accel. Fall back to the constraining single-
  // phase time (no cruise, no triangle).
  if (vPeak <= Math.max(entryV, exitV)) {
    // Pure accel (entry < exit) or pure decel (entry > exit) over d.
    // Time = 2d / (entry + exit) if entry+exit > 0; else accel-from-rest.
    const sum = entryV + exitV;
    if (sum > 0) return (2 * d) / sum;
    return Math.sqrt((2 * d) / accel);
  }
  const tAccel = (vPeak - entryV) / accel;
  const tDecel = (vPeak - exitV) / accel;
  return tAccel + tDecel;
}

function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function unitVector(from: Vec2, to: Vec2, length: number): Vec2 {
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

function blockMotion(block: Block): BlockMotion {
  return block.motion ?? (block.kind === 'cut' ? 'feed' : 'rapid');
}

// Compatibility note: a future per-group export could expose Block[]
// for visualization (preview G-code velocity profile). Out of scope
// for the estimator itself.
export type { Block, CutGroup, FillGroup };
