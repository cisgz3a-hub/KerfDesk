// ADR-239 Amendment 2: the laser-off exit runway an M3 (constant-power)
// contour leaves by on the 4040-safe profile, mirroring its ADR-239 entry.
//
// Under M3 GRBL holds the programmed power while the head decelerates
// (laser_mode.md: "keeps the laser power as programmed, regardless if the
// machine is moving, accelerating, or stopped"), so a contour whose last burn
// edge is followed by a seek in another direction slows to that junction on
// the ink at full power and burns a dark end. The exit continues along the
// last burn edge, `S0` at burn feed: the junction into it is collinear, so the
// head passes the last vertex at burn feed and decelerates dark. A simulated
// 5 mm exit brought simple-shape ends from 1.6-5.3x to 1.00x the line dose
// (quality audit Q6-P2-1). It is bounded by the bed and skipped with an
// unknown bed envelope exactly as the entry is (ADR-343).

import type { CutGroup, CutSegment, FillGroup } from '../job';
import { contourExitPoint, type ContourEntryBounds } from '../job/contour-entry';
import { formatGcodeCoordinateMm } from '../gcode';
import { laserOffRunwayLine } from './grbl-laser-lines';
import { surfaceMatchedFeed, type RotaryFeedContext } from './rotary-surface-feed';
import { emittedHead, laserOffMoveLines, type LaserOutputCursor } from './grbl-output-cursor';

/** The runway fields a contour group's segment emission reads. */
export function contourRunways(group: CutGroup | FillGroup): {
  readonly entryRunwayMm: number | undefined;
  readonly exitRunwayMm: number | undefined;
} {
  return { entryRunwayMm: group.entryRunwayMm, exitRunwayMm: group.exitRunwayMm };
}

/** The exit move written after a contour's last burn point, or nothing. It
 * goes through the output cursor like any laser-off move, so transitions held
 * behind a lit M3 burn (OR-1) now drain with the beam dark. */
export function contourExitLines(
  seg: CutSegment,
  context: RotaryFeedContext & {
    readonly exitRunwayMm?: number | undefined;
    readonly entryBounds: ContourEntryBounds;
    readonly cursor: LaserOutputCursor;
    readonly feed: number;
  },
): string[] {
  if (context.exitRunwayMm === undefined) return [];
  const exit = contourExitPoint(seg.polyline, context.exitRunwayMm, context.entryBounds);
  const last = seg.polyline[seg.polyline.length - 1];
  if (exit === null || last === undefined) return [];
  // ADR-127 Amd 2: the exit continues the last burn edge, so it keeps its feed.
  const feed = surfaceMatchedFeed(context.feed, last, exit, context.rotaryFeed);
  return laserOffMoveLines(
    context.cursor,
    emittedHead(exit.x, exit.y),
    laserOffRunwayLine(exit.x, exit.y, feed),
  );
}

/** Layer-comment disclosure, worded like the entry's (ADR-239 Amendment 1). */
export function contourExitComment(
  exitRunwayMm: number | undefined,
  entryBounds: ContourEntryBounds,
): string {
  if (exitRunwayMm === undefined) return '';
  return entryBounds === null
    ? ' contour-exit skipped (bed position unknown)'
    : ` contour-exit ${formatGcodeCoordinateMm(exitRunwayMm)} mm effective laser-off feed`;
}
