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

export type BlankFeedIssue = Issue & { readonly distanceMm: number };

export type BlankFeedOptions = { readonly thresholdMm: number };

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const X_RE = new RegExp(String.raw`\bX${NUM}`);
const Y_RE = new RegExp(String.raw`\bY${NUM}`);
const S_RE = new RegExp(String.raw`\bS${NUM}`);
const DISTANCE_EPS_MM = 1e-6;

function parseValue(line: string, re: RegExp): number | null {
  const m = re.exec(line);
  if (!m || m[1] === undefined) return null;
  return Number.parseFloat(m[1]);
}

function stripComment(line: string): string {
  const semi = line.indexOf(';');
  return (semi >= 0 ? line.slice(0, semi) : line).trim();
}

export function findLongBlankFeedMoves(
  gcode: string,
  options: BlankFeedOptions,
): readonly BlankFeedIssue[] {
  const threshold = options.thresholdMm;
  const lines = gcode.split('\n');
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
    const stripped = stripComment(raw);
    if (stripped === '') continue;
    const sVal = parseValue(stripped, S_RE);
    if (sVal !== null) stickyS = sVal;
    if (!/^G[0-3]\b/.test(stripped)) continue;
    const fromX = x;
    const fromY = y;
    const nx = parseValue(stripped, X_RE);
    const ny = parseValue(stripped, Y_RE);
    if (nx !== null) x = nx;
    if (ny !== null) y = ny;
    // Only a G1 (cutting feed) with the laser off is a blank feed. G0 rapids are
    // owned by the laser-on-travel invariant and are the right way to cross gaps.
    if (!/^G1\b/.test(stripped)) continue;
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
