// cnc-pause-reentry (ADR-410) — where a paused CNC job re-enters its own cut
// after "Pause and lift", and the lines that take it there.
//
// Pause stops the router in place with the bit in the wood. To lift it, the
// controller's hold has to be cleared with a soft reset, which throws away
// every line it had buffered. So Resume cannot just cycle-start: it has to
// know which program line the bit was on and replay the job from there. The
// stop point is matched against the toolpath of the lines the controller had
// acknowledged (plus the one it was still planning), inside the same planner
// window pass recovery uses (ADR-215): only a line that may still have been
// executing can be the one the bit stopped on.
//
// Several lines can pass through the stop point (a contour's start and end,
// a plunge above a corner). The EARLIEST match wins. Every line between it and
// the line really executing has already been cut, so replaying from too early
// only recuts; replaying from too late would skip material and could plunge
// a later, deeper pass into uncut stock.
//
// A straight line re-enters at the stop point itself: the bit was there, so
// the plunge back down goes into its own empty kerf. An arc re-enters at its
// start, which the bit also passed, and recuts to the stop point.

import { isToolChangeLine } from '../controllers/grbl/streamer';
import type { ControllerKind } from '../devices';
import { formatGcodeCoordinateMm } from '../gcode';
import { buildMotionManifest, type MotionBlock, type MotionPoint } from '../job/motion-manifest';
import { cncResumePlannerReserveLines } from './cnc-resume-point';
import {
  scanCncReentryProgram,
  type CncMotionMode,
  type CncReentryModal,
} from './cnc-pause-reentry-program';

/** Farthest a reported stop point may lie from a program line and still be
 *  on it. GRBL stops on its own path; this covers the 0.05 mm chord error of
 *  the sampled arcs (ARC_CHORD_TOLERANCE_MM) with margin. A generous value
 *  can only add earlier matches, which recut rather than skip. */
export const CNC_REENTRY_MATCH_TOLERANCE_MM = 0.1;
const Z_EPSILON_MM = 0.001;

/** Firmware whose soft reset at a completed hold keeps position without an
 *  alarm, and whose restart this re-entry was built against (ADR-410). */
const LIFT_CONTROLLERS: ReadonlySet<ControllerKind> = new Set(['grbl-v1.1', 'grblhal']);

export type CncPauseReentryPlan = {
  /** First sendable line the stream replays. */
  readonly resumeLineIndex: number;
  /** Where the bit goes back down, in work millimetres. */
  readonly entry: MotionPoint;
  /** Highest rapid height the program used before the resume line. */
  readonly safeZMm: number;
  readonly spindle: 'M3' | 'M4';
  readonly spindleRpm: number;
  readonly spinupSec: number;
  readonly mist: boolean;
  readonly flood: boolean;
  readonly plungeFeedMmPerMin: number;
  /** Motion mode and feed in effect when the resume line starts. */
  readonly motion: CncMotionMode;
  readonly feedMmPerMin: number;
};

export type CncPauseReentryResult =
  | { readonly kind: 'plan'; readonly plan: CncPauseReentryPlan }
  | { readonly kind: 'no-lift'; readonly reason: string };

export type CncPauseReentryInput = {
  /** The stream's sendable lines (streamer.queued). */
  readonly lines: ReadonlyArray<string>;
  /** Lines the controller acknowledged before the pause (streamer.completed). */
  readonly ackedLines: number;
  /** Lines sent before the pause (streamer.queueIndex). GRBL acknowledges an
   *  arc only once all its segments are planned, so the first unacknowledged
   *  line may already be moving. Defaults to `ackedLines`. */
  readonly sentLines?: number;
  /** Settled work position of the paused bit, millimetres. */
  readonly stopPoint: MotionPoint;
  readonly controllerKind: ControllerKind;
  readonly plannerBlocks?: number | undefined;
};

export function planCncPauseReentry(input: CncPauseReentryInput): CncPauseReentryResult {
  if (!LIFT_CONTROLLERS.has(input.controllerKind)) {
    return noLift(`Pause and lift is not qualified on ${input.controllerKind}.`);
  }
  const acked = Math.min(Math.max(Math.floor(input.ackedLines), 0), input.lines.length);
  const sent = Math.min(Math.floor(input.sentLines ?? acked), input.lines.length);
  const windowEnd = Math.max(acked, Math.min(acked + 1, sent));
  const reserve = cncResumePlannerReserveLines(input.controllerKind, input.plannerBlocks);
  const windowStart = Math.max(0, acked - reserve, lastToolChangeBoundary(input.lines, acked));
  const manifest = buildMotionManifest(input.lines.slice(0, windowEnd).join(''), {
    machineKind: 'cnc',
  });
  const block = manifest.blocks.find(
    (candidate) =>
      candidate.sendableLineIndex >= windowStart &&
      distanceToPolyline(input.stopPoint, candidate.points) <= CNC_REENTRY_MATCH_TOLERANCE_MM,
  );
  if (block === undefined) {
    return noLift('The stop point is not on any line the controller may have been running.');
  }
  const scan = scanCncReentryProgram(input.lines, block.sendableLineIndex, windowEnd);
  if (!scan.ok) return noLift(scan.reason);
  return planFromScan(input.stopPoint, block, manifest.blocks, scan);
}

type CompletedScan = Extract<ReturnType<typeof scanCncReentryProgram>, { readonly ok: true }>;

function planFromScan(
  stopPoint: MotionPoint,
  block: MotionBlock,
  blocks: ReadonlyArray<MotionBlock>,
  scan: CompletedScan,
): CncPauseReentryResult {
  const modal: CncReentryModal = scan.atResume;
  const k = block.sendableLineIndex;
  const spinup = spinupAtStop(modal);
  if (typeof spinup === 'string') return noLift(spinup);
  const safeZMm = highestRapidZ(blocks, k, scan.motionAt);
  if (safeZMm === null) return noLift('The program has no rapid height before the stop point.');
  if (stopPoint.z >= safeZMm - Z_EPSILON_MM) {
    return noLift('The bit already stopped at or above safe height.');
  }
  const arc = scan.motionAt[k] === 2 || scan.motionAt[k] === 3;
  if (arc && !scan.resumeLineNamesArc) {
    return noLift('The arc the bit stopped on does not name its own G2/G3.');
  }
  const plungeFeedMmPerMin = plungeFeedAt(blocks, k, scan);
  if (typeof plungeFeedMmPerMin === 'string') return noLift(plungeFeedMmPerMin);
  return {
    kind: 'plan',
    plan: {
      resumeLineIndex: k,
      entry: arc ? (block.points[0] ?? stopPoint) : stopPoint,
      safeZMm,
      ...spinup,
      mist: modal.mist,
      flood: modal.flood,
      plungeFeedMmPerMin,
      motion: modal.motion,
      feedMmPerMin: modal.feedMmPerMin,
    },
  };
}

/** The spindle Resume restarts and how long it waits, or why it cannot. */
function spinupAtStop(
  modal: CncReentryModal,
): Pick<CncPauseReentryPlan, 'spindle' | 'spindleRpm' | 'spinupSec'> | string {
  if (modal.spindle === null || modal.spindleRpm <= 0) {
    return 'The spindle was off at the stop point, so Resume cannot spin up in the cut.';
  }
  if (modal.spinupSec === null) return 'The program has no spin-up dwell after its spindle start.';
  return { spindle: modal.spindle, spindleRpm: modal.spindleRpm, spinupSec: modal.spinupSec };
}

/** The plunge feed back into the kerf, or why none is known. */
function plungeFeedAt(
  blocks: ReadonlyArray<MotionBlock>,
  k: number,
  scan: CompletedScan,
): number | string {
  // The resume line runs at its own feed when it names one.
  const lineFeed = scan.feedAt[k] ?? 0;
  if (scan.motionAt[k] !== 0 && lineFeed <= 0)
    return 'No feed rate is in effect at the stop point.';
  const plunge = lastPlungeFeed(blocks, k, scan) ?? lineFeed;
  return plunge > 0 ? plunge : 'No plunge feed rate is known.';
}

function noLift(reason: string): CncPauseReentryResult {
  return { kind: 'no-lift', reason };
}

// The streamer holds a tool-change M0 back host-side and only moves past it
// on Continue, after a drained planner and a fresh Idle. No line before an
// acknowledged M0 can still be executing (cnc-resume-point.ts).
function lastToolChangeBoundary(lines: ReadonlyArray<string>, acked: number): number {
  for (let index = acked - 1; index >= 0; index -= 1) {
    if (isToolChangeLine(lines[index] ?? '')) return index + 1;
  }
  return 0;
}

function highestRapidZ(
  blocks: ReadonlyArray<MotionBlock>,
  resumeIndex: number,
  motionAt: Uint8Array,
): number | null {
  let highest: number | null = null;
  for (const block of blocks) {
    if (block.sendableLineIndex >= resumeIndex) break;
    if (motionAt[block.sendableLineIndex] !== 0) continue;
    const z = block.points.at(-1)?.z;
    if (z !== undefined && (highest === null || z > highest)) highest = z;
  }
  return highest;
}

// The feed of the program's latest straight-down G1, up to and including the
// resume line itself.
function lastPlungeFeed(
  blocks: ReadonlyArray<MotionBlock>,
  resumeIndex: number,
  scan: { readonly motionAt: Uint8Array; readonly feedAt: Float64Array },
): number | null {
  let feed: number | null = null;
  for (const block of blocks) {
    const index = block.sendableLineIndex;
    if (index > resumeIndex) break;
    if (block.kind !== 'plunge' || scan.motionAt[index] !== 1) continue;
    const from = block.points[0];
    const to = block.points.at(-1);
    if (from !== undefined && to !== undefined && to.z < from.z) feed = scan.feedAt[index] ?? null;
  }
  return feed;
}

function distanceToPolyline(point: MotionPoint, points: ReadonlyArray<MotionPoint>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(p: MotionPoint, a: MotionPoint, b: MotionPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengthSquared),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
}

/** The modal preamble every lift and re-entry restates: a `$N` startup block
 *  runs after the reset and may leave any of it changed. */
export const CNC_REENTRY_MODAL_LINE = 'G21 G90 G54 G94 G17';

export function cncPauseLiftLine(plan: CncPauseReentryPlan): string {
  return `G0 Z${mm(plan.safeZMm)}`;
}

export type CncReentryStep =
  | { readonly kind: 'modal' | 'spindle' | 'coolant' | 'restore'; readonly line: string }
  | { readonly kind: 'dwell'; readonly line: string; readonly seconds: number }
  | { readonly kind: 'move'; readonly line: string; readonly target: Partial<MotionPoint> };

/** The lines Resume sends, one at a time, before the stream replays from the
 *  resume line: lift to safe height first (nothing may have moved, but the
 *  XY move must never run low), spin up there, return, plunge into the kerf,
 *  then put the motion mode and feed back. */
export function cncReentrySteps(plan: CncPauseReentryPlan): ReadonlyArray<CncReentryStep> {
  const { entry } = plan;
  const coolant: CncReentryStep[] = [
    ...(plan.mist ? [{ kind: 'coolant' as const, line: 'M7' }] : []),
    ...(plan.flood ? [{ kind: 'coolant' as const, line: 'M8' }] : []),
  ];
  return [
    { kind: 'modal', line: CNC_REENTRY_MODAL_LINE },
    { kind: 'move', line: cncPauseLiftLine(plan), target: { z: plan.safeZMm } },
    { kind: 'spindle', line: `${plan.spindle} S${Math.round(plan.spindleRpm)}` },
    { kind: 'dwell', line: `G4 P${seconds(plan.spinupSec)}`, seconds: plan.spinupSec },
    ...coolant,
    {
      kind: 'move',
      line: `G0 X${mm(entry.x)} Y${mm(entry.y)}`,
      target: { x: entry.x, y: entry.y, z: plan.safeZMm },
    },
    {
      kind: 'move',
      line: `G1 Z${mm(entry.z)} F${feed(plan.plungeFeedMmPerMin)}`,
      target: { x: entry.x, y: entry.y, z: entry.z },
    },
    { kind: 'restore', line: restoreModalLine(plan) },
  ];
}

// G0/G1 with no axis words set the mode without moving. An arc line names its
// own G2/G3 (checked by the planner), so G1 carries the feed for it.
function restoreModalLine(plan: CncPauseReentryPlan): string {
  const mode = plan.motion === 0 ? 'G0' : 'G1';
  return plan.feedMmPerMin > 0 ? `${mode} F${feed(plan.feedMmPerMin)}` : mode;
}

function mm(value: number): string {
  return formatGcodeCoordinateMm(value);
}

function feed(value: number): string {
  return trimNumber(value, 3);
}

function seconds(value: number): string {
  return trimNumber(value, 3);
}

function trimNumber(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}
