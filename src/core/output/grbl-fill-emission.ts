// Scanline fill groups for the GRBL laser emitter. Each scanline's nearby runs
// become continuous G1 sweeps with S0 gaps (ADR-034); wide gaps split into
// independently planned sweeps (ADR-035). Generic Scan Line gives every sweep
// bounded feed-matched laser-off entry and exit motion. The 4040 plan retains
// its qualified bounded-entry policy.

import type { DeviceProfile, GrblGcodeDialect } from '../devices';
import type { FillGroup } from '../job';
import { expandFillHatchWithRunways } from '../job/fill-runway';
import { planFillSweeps, type FillSweepPlan } from '../job/fill-sweep-plan';
import type { FillSpan } from '../job/fill-sweeps';
import { offsetForSpeed } from '../job/scan-offset';
import { formatGcodeCoordinateMm } from '../gcode';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { fillRunwayCommentText } from './fill-runway-comment';
import {
  LINE_END,
  feedComment,
  laserOffRunwayLine,
  laserOffSeekLine,
  pushOperationProvenanceComment,
  roundedPositiveFeed,
  scaleS,
} from './grbl-laser-lines';
import {
  emittedHead,
  heldLinesBeforeBurn,
  laserOffMoveLines,
  noteBurn,
  noteLaserOffMove,
  type LaserOutputCursor,
} from './grbl-output-cursor';

type FillGroupEmissionContext = {
  readonly device: DeviceProfile;
  readonly dialect: GrblGcodeDialect;
  readonly cursor: LaserOutputCursor;
};

// One planned sweep. Seek to its entry runway with the device's laser-off
// travel policy, traverse the runway in rapid/controlled or feed-matched mode,
// then keep one G1 chain across ink and S0 holes. G-code S is modal, so every
// span re-asserts its value.
type FillSweepEmissionContext = FillGroupEmissionContext & {
  readonly s: number;
  readonly feed: number;
};

export function emitScanlineFillGroup(group: FillGroup, groupContext: FillGroupEmissionContext) {
  const { device } = groupContext;
  const s = scaleS(group.power, device.maxPowerS);
  const feed = roundedPositiveFeed(group.speed, `Layer ${group.layerId}`);
  const chunks: string[] = [];
  const overscanText = fillRunwayCommentText(group, formatGcodeCoordinateMm);
  chunks.push(
    `; fill layer ${group.layerId} color ${group.color} power ${group.power}% ${feedComment(group, feed)} passes ${group.passes} ${overscanText}`,
  );
  pushOperationProvenanceComment(chunks, group);
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, feed);
  const sweepPlans = planFillSweeps(group, scanOffsetMm);
  const context: FillSweepEmissionContext = { ...groupContext, s, feed };
  for (let p = 0; p < group.passes; p += 1) {
    chunks.push(`; pass ${p + 1} of ${group.passes}`);
    for (const plan of sweepPlans) {
      const text = emitFillSweep(plan, context);
      if (text.length > 0) chunks.push(text);
    }
  }
  return chunks.join(LINE_END) + LINE_END;
}

function emitFillSweep(plan: FillSweepPlan, context: FillSweepEmissionContext): string {
  const spans = plan.sweep.spans;
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return '';
  const run = expandFillHatchWithRunways([first.start, last.end], plan);
  if (run === null) return '';
  const { device, dialect, cursor } = context;
  const lines: string[] = laserOffMoveLines(
    cursor,
    emittedHead(run.leadStart.x, run.leadStart.y),
    laserOffSeekLine(run.leadStart.x, run.leadStart.y, device, dialect),
  );
  if (plan.leadInMm > 0) {
    lines.push(...runwayLines(run.burnStart, plan, context));
  }
  for (const line of sweepSpanLines(spans, context)) {
    lines.push(line);
  }
  if (plan.leadOutMm > 0) {
    lines.push(...runwayLines(run.leadEnd, plan, context));
  }
  return lines.join(LINE_END);
}

function runwayLines(
  target: FillSpan['start'],
  plan: FillSweepPlan,
  context: FillSweepEmissionContext,
): string[] {
  const line =
    plan.runwayMotion === 'rapid'
      ? laserOffSeekLine(target.x, target.y, context.device, context.dialect)
      : laserOffRunwayLine(target.x, target.y, context.feed);
  return laserOffMoveLines(context.cursor, emittedHead(target.x, target.y), line);
}

// The G1 chain for one sweep: burn each ink span (S{s}), blank each interior
// gap (S0). F rides only the first emitted G1 (modal). A head tracker skips any
// move whose target equals the current position at emit precision (3 dp), so a
// degenerate span never emits a stationary beam-on G1 and two touching spans
// never emit a zero-length gap — defense in depth for PROJECT.md #3 ("positive
// S only on a moving G1"). The live producer already filters sub-epsilon runs
// (fill-hatching SCANLINE_EPS); this guards the contract at the emitter too
// (audit 2026-06-03).
function sweepSpanLines(
  spans: ReadonlyArray<FillSpan>,
  context: FillSweepEmissionContext,
): string[] {
  const first = spans[0];
  if (first === undefined) return [];
  const { s, feed, device, dialect, cursor } = context;
  const lines: string[] = [];
  // Fill sweeps keep the verbose spelling. Their G1s are whole spans — metres
  // of motion per line at the emitter's 5 mm minimum runway — so the planner
  // cannot starve on them and the bytes buy nothing (ADR-332). Raster rows,
  // one short G1 per power change, are where compaction pays.
  // Head starts where the planned runway move left it: the first span's start.
  let head = emittedHead(first.start.x, first.start.y);
  let feedEmitted = false;
  const moveTo = (x: number, y: number, power: number): void => {
    const target = emittedHead(x, y);
    if (target.x === head.x && target.y === head.y) return; // zero-length at emit precision — skip
    // Held transitions only remain when the seek and runway were both dropped.
    if (!feedEmitted) {
      lines.push(
        ...heldLinesBeforeBurn(cursor, { start: first.start, firstTarget: { x, y } }, (sx, sy) =>
          laserOffSeekLine(sx, sy, device, dialect),
        ),
      );
    }
    const feedWord =
      feedEmitted && dialect.modalFeedrate ? '' : ` F${formatGcodeFeedMmPerMin(feed)}`;
    feedEmitted = true;
    lines.push(`G1 X${target.x} Y${target.y}${feedWord} S${power}`);
    head = target;
    if (power > 0) noteBurn(cursor, target);
    else noteLaserOffMove(cursor, target);
  };
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span === undefined) continue;
    moveTo(span.end.x, span.end.y, s);
    const next = spans[i + 1];
    if (next !== undefined) moveTo(next.start.x, next.start.y, 0);
  }
  return lines;
}
