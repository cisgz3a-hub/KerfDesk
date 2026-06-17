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

import type { DeviceProfile } from '../devices';
import type { Vec2 } from '../scene';
import { effectiveOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';
import { groupFillSweeps } from './fill-sweeps';
import type { CutGroup, FillGroup, Job } from './job';

const SECONDS_PER_MINUTE = 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };

type BlockKind = 'cut' | 'travel';

type Block = {
  readonly kind: BlockKind;
  readonly distance: number; // mm
  readonly targetVelocity: number; // mm/sec
  // Unit direction vector. Travels with zero length are filtered out
  // before block creation so this is always defined for real blocks.
  readonly direction: Vec2;
};

export type PlannedDuration = {
  readonly totalSeconds: number;
  readonly breakdown: { readonly cutSeconds: number; readonly travelSeconds: number };
};

export function estimateWithPlanner(job: Job, device: DeviceProfile): PlannedDuration {
  const accel = Math.max(1, device.accelMmPerSec2);
  const jd = Math.max(0, device.junctionDeviationMm);
  const travelV = Math.max(1, device.maxFeed) / SECONDS_PER_MINUTE;
  const blocks = buildBlocks(job, device, travelV);
  if (blocks.length === 0)
    return { totalSeconds: 0, breakdown: { cutSeconds: 0, travelSeconds: 0 } };
  const plan = planVelocities(blocks, accel, jd);
  let cutSeconds = 0;
  let travelSeconds = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const p = plan[i];
    if (block === undefined || p === undefined) continue;
    const t = blockTime(block, p.entryV, p.exitV, accel);
    if (block.kind === 'cut') cutSeconds += t;
    else travelSeconds += t;
  }
  return { totalSeconds: cutSeconds + travelSeconds, breakdown: { cutSeconds, travelSeconds } };
}

// Block decomposition. Walks every cut segment and produces one block
// per polyline edge (cut, full feed), preceded by a one-block travel
// from the previous cursor position. Postamble back to origin is a
// final travel block. Multi-pass repeats the cut blocks.
function buildBlocks(job: Job, device: DeviceProfile, travelV: number): Block[] {
  const out: Block[] = [];
  let cursor: Vec2 = ORIGIN;
  for (const group of job.groups) {
    // F.2.d: planner-aware estimator works on vector blocks (one
    // per polyline edge). Raster groups produce a different motion
    // model (constant-feed sweeps) — skipped here and accounted
    // for separately in estimate-duration's raster path.
    if (group.kind === 'raster') continue;
    const cutV = groupCutVelocity(group, device);
    cursor =
      group.kind === 'fill' && (group.fillStyle ?? 'scanline') !== 'offset'
        ? appendFillGroupBlocks(out, cursor, group, cutV, travelV)
        : appendCutGroupBlocks(out, cursor, group, cutV, travelV);
  }
  appendTravel(out, cursor, ORIGIN, travelV);
  return out;
}

function groupCutVelocity(group: CutGroup | FillGroup, device: DeviceProfile): number {
  return Math.max(1, Math.min(group.speed, device.maxFeed)) / SECONDS_PER_MINUTE;
}

function appendFillGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: FillGroup,
  cutV: number,
  travelV: number,
): Vec2 {
  let cursor = initialCursor;
  const sweeps = groupFillSweeps(group.segments);
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const sweep of sweeps) {
      const first = sweep.spans[0];
      const last = sweep.spans[sweep.spans.length - 1];
      if (first === undefined || last === undefined) continue;
      // A scanline is one continuous G1 sweep at feed (ink + S0-blanked gaps),
      // so the burn is a SINGLE cut block from the first span's start to the
      // last span's end — no per-run full stop (ADR-034). The gaps move at feed
      // too, so pricing the whole span as one cut block is accurate for total
      // time. The overscan runway is laser-off rapid travel; short sweeps skip
      // it (effectiveOverscanMm → 0, zero-length travels drop out).
      const overscan = effectiveOverscanMm([first.start, last.end], group.overscanMm);
      const run = expandFillHatchWithOverscan([first.start, last.end], overscan);
      if (run === null) continue;
      appendTravel(out, cursor, run.leadStart, travelV);
      appendTravel(out, run.leadStart, run.burnStart, travelV);
      appendCut(out, run.burnStart, run.burnEnd, cutV);
      appendTravel(out, run.burnEnd, run.leadEnd, travelV);
      cursor = run.leadEnd;
    }
  }
  return cursor;
}

function appendCutGroupBlocks(
  out: Block[],
  initialCursor: Vec2,
  group: CutGroup | FillGroup,
  cutV: number,
  travelV: number,
): Vec2 {
  let cursor = initialCursor;
  for (let pass = 0; pass < group.passes; pass += 1) {
    for (const seg of group.segments) {
      const first = seg.polyline[0];
      if (first === undefined) continue;
      appendTravel(out, cursor, first, travelV);
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
  out.push({ kind: 'travel', distance: d, targetVelocity: v, direction: unitVector(from, to, d) });
}

function appendCut(out: Block[], from: Vec2, to: Vec2, v: number): void {
  const d = distance(from, to);
  if (d <= 0) return;
  out.push({ kind: 'cut', distance: d, targetVelocity: v, direction: unitVector(from, to, d) });
}

type PlanEntry = { entryV: number; exitV: number };

// Two-pass lookahead. Sets entry/exit velocities per block such that
// physics holds (accel/decel reachable) AND cornering doesn't exceed
// junction-deviation limits.
function planVelocities(blocks: ReadonlyArray<Block>, accel: number, jd: number): PlanEntry[] {
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
    p.entryV = Math.min(next.targetVelocity, vJunction);
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
    p.exitV = Math.min(p.exitV, maxExit);
  }
}

// Sonny Jeon's junction-deviation formula. θ is the angle between the
// previous block's direction and the next block's direction.
// sin(θ/2) is computed from the dot product without an explicit acos.
export function junctionVelocity(prev: Block, next: Block, accel: number, jd: number): number {
  // Travels run with laser off so the start of a cut following a
  // travel is effectively a fresh path — junction analysis with a
  // travel doesn't help (we won't smoothly transition between them).
  // Same for travel after cut. Treat all transitions crossing the
  // cut/travel boundary as full stops.
  if (prev.kind !== next.kind) return 0;
  const cosTheta = prev.direction.x * next.direction.x + prev.direction.y * next.direction.y;
  // Clamp to handle float noise just outside [-1, 1].
  const clamped = Math.min(1, Math.max(-1, cosTheta));
  // sin(θ/2) = √((1 − cos θ) / 2). At θ=0 (straight): sin = 0 → v_j → ∞
  // (returns Infinity, caller mins against target). At θ=π (reverse):
  // sin = 1 → division by zero → must stop, return 0.
  const sinHalf = Math.sqrt((1 - clamped) / 2);
  if (sinHalf <= 0) return Number.POSITIVE_INFINITY;
  if (sinHalf >= 1) return 0;
  return Math.sqrt((accel * jd * sinHalf) / (1 - sinHalf));
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

// Compatibility note: a future per-group export could expose Block[]
// for visualization (preview G-code velocity profile). Out of scope
// for the estimator itself.
export type { Block, CutGroup, FillGroup };
