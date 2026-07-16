// findLongBlankFeedMoves — flags G1 *feed* moves made with the laser commanded
// OFF (effective S0) across a distance longer than the threshold.
//
// This is a DIFFERENT failure mode from findLaserOnTravelIssues, deliberately
// kept separate:
//   - G0 without S0 / M5 is a HARD safety invariant (the laser may fire during
//     a rapid). findLaserOnTravelIssues owns that, and a G0 is the CORRECT way
//     to cross a long gap, so this invariant ignores G0 entirely.
//   - A long G1 with effective S0 is a MATERIAL-MARKING + STALE-OUTPUT
//     invariant: the head crawls across empty space at cutting feed with the
//     beam nominally off, and a diode's turn-off lag can paint a faint line over
//     that distance (the 2026-06-03 "moved to the second part and left a stray
//     line" class). ADR-035 split fill gaps > 5 mm into G0 rapids, so FRESH
//     output has no long blank feed; if one appears, the g-code is either a
//     regression or a stale export that predates the fix. Either way, block it.
//
// Tracks modal X/Y/S exactly as the controller would. Pure-core: no clock, no
// random, no I/O.

import type { Issue } from './predicates';
import {
  asGcodeLines,
  isGcodeCommand,
  isGcodeMotionCommand,
  parseGcodeWord,
  stripGcodeComment,
} from './gcode-words';

export type BlankFeedIssue = Issue & { readonly distanceMm: number };

export type BlankFeedOptions = { readonly thresholdMm: number };

const DISTANCE_EPS_MM = 1e-6;

export function findLongBlankFeedMoves(
  gcode: string | ReadonlyArray<string>,
  options: BlankFeedOptions,
): readonly BlankFeedIssue[] {
  const threshold = options.thresholdMm;
  const lines = asGcodeLines(gcode);
  const issues: BlankFeedIssue[] = [];
  // The controller starts parked at the origin; X/Y/S are modal thereafter.
  let x = 0;
  let y = 0;
  // null until the first S word is seen — a move before any S is not provably
  // "blank", so it is never flagged.
  let stickyS: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripGcodeComment(raw);
    if (stripped === '') continue;
    const sVal = parseGcodeWord(stripped, 'S');
    if (sVal !== null) stickyS = sVal;
    if (!isGcodeMotionCommand(stripped)) continue;
    const fromX = x;
    const fromY = y;
    const nx = parseGcodeWord(stripped, 'X');
    const ny = parseGcodeWord(stripped, 'Y');
    if (nx !== null) x = nx;
    if (ny !== null) y = ny;
    // Only a G1 (cutting feed) with the laser off is a blank feed. G0 rapids are
    // owned by the laser-on-travel invariant and are the right way to cross gaps.
    if (!isGcodeCommand(stripped, 'G1')) continue;
    if (stickyS !== 0) continue;
    const distanceMm = Math.hypot(x - fromX, y - fromY);
    if (distanceMm - threshold > DISTANCE_EPS_MM) {
      issues.push({
        lineNumber: i + 1,
        line: raw,
        reason: `blank G1 feed move ${distanceMm.toFixed(3)} mm exceeds ${threshold.toFixed(3)} mm`,
        distanceMm,
      });
    }
  }
  return issues;
}
