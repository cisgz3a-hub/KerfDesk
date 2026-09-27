// Every relief finishing move checked against the exact contact (ADR-421
// Amendment 1). The planners place their vertices on exact tip heights, but
// the bit travels straight between them. Where a move crosses the edge of a
// wall, the tip the cutter needs rises along a curve (a ball rolling over an
// edge traces a circle), and the straight move between two samples cuts under
// it: 0.078 mm on the ADR-412 bench relief with a 1/8" ball.
//
// Each move is checked every quarter cell of its length in 3D, as ADR-423's
// waterline moves and ADR-450's links are checked every quarter cell, four
// cells at a time against only the elements that could rise above those four
// cells (SurfaceContactField.alongMove): most of a finishing path already lies
// on the contact, and there nothing needs solving at all.
//
// The tolerance holds normal to the move, the way ADR-412 measures a cutter
// cutting into a wall. A cutter that sits some height under the contact
// partway along a move inclined at angle a cuts that height times cos(a) into
// the part: at the worst point of a smooth contact the contact runs parallel
// to the move, and where it bends sharply (a flat end mill leaving a ledge)
// the cutter cuts in less. So a move down a near-vertical wall may pass well
// under the contact's height at its point without touching the wall.
//
// Where a move cuts in more than the tolerance, the worst point is inserted
// at its contact height and both halves are checked again. A move still
// failing after the last split is so short that it is crossed at the higher
// of its two ends and every height found on it: up, across and down. Points
// are only ever added or raised, so a checked path never cuts deeper than the
// one it replaces.

import type { CncPass } from '../job';
import { FINISHING_REDUCTION_TOLERANCE_MM, type FinishingPoint } from './relief-finishing-path';

// A straight move may cut this far into the part, normal to the move: the
// same band the one-sided reduction may leave above it, so the finishing path
// stays within 0.002 mm of the exact contact either way.
export const FINISHING_CONTACT_TOLERANCE_MM = FINISHING_REDUCTION_TOLERANCE_MM;
const MAX_SPLITS = 12;
// Checks per stretch asked about at once: four cells, under the radius of a
// cutter the finishing grid gives ten cells across, so a long move beside a
// wall solves the wall only where it passes within reach.
const CHECKS_PER_STRETCH = 16;
// Extra checks in a move's first and last interval, at these fractions of it
// from the end. Vertices sit on samples, and where a flat-bottomed cutter's
// rim leaves a ledge the contact bends sharply within a cell of one: the move
// leaves the contact at its own slope, and the cut grows until the bend.
const END_FRACTIONS = [1 / 8, 1 / 4, 1 / 2];
const SAME_POINT_MM = 1e-9;

export type ContactTip = (x: number, y: number, lowerBound: number) => number;

export type ContactCheck = {
  // The cutter's contact height at (x, y), or `lowerBound` when nothing
  // requires more.
  readonly tipAt: ContactTip;
  // Optional: the contact that matters along one move, or null when nothing
  // can rise more than `toleranceMm` above it. Without it every check asks
  // tipAt.
  readonly alongMove?: (
    from: FinishingPoint,
    to: FinishingPoint,
    toleranceMm: number,
  ) => ContactTip | null;
  // Largest distance between two checks along a move, measured in 3D.
  readonly spacingMm: number;
};

/** Every path3d pass with its moves checked against the exact contact. */
export function checkedAgainstContact(
  passes: ReadonlyArray<CncPass>,
  check: ContactCheck,
): ReadonlyArray<CncPass> {
  return passes.map((pass) =>
    pass.kind === 'path3d' ? { ...pass, points: checkedPath(pass.points, check) } : pass,
  );
}

export function checkedPath(
  points: ReadonlyArray<FinishingPoint>,
  check: ContactCheck,
): ReadonlyArray<FinishingPoint> {
  const first = points[0];
  if (first === undefined) return points;
  const out: FinishingPoint[] = [first];
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index];
    if (to !== undefined) appendCheckedMove(out, out[out.length - 1] ?? to, to, check, 0);
  }
  return out;
}

// Appends the move from `from` to `to` (not `from` itself), split where the
// straight line would cut under the contact.
function appendCheckedMove(
  out: FinishingPoint[],
  from: FinishingPoint,
  to: FinishingPoint,
  check: ContactCheck,
  splits: number,
): void {
  const worst = worstCheck(from, to, check);
  if (worst === null) {
    out.push(to);
    return;
  }
  if (splits >= MAX_SPLITS) {
    const top = Math.max(from.z, to.z, worst.z);
    if (top > from.z) out.push({ x: from.x, y: from.y, z: top });
    if (top > to.z) out.push({ x: to.x, y: to.y, z: top });
    out.push(to);
    return;
  }
  appendCheckedMove(out, from, worst, check, splits + 1);
  appendCheckedMove(out, worst, to, check, splits + 1);
}

// The check point where the straight move lies farthest below the contact,
// at its contact height; null when every check is within the tolerance.
function worstCheck(
  from: FinishingPoint,
  to: FinishingPoint,
  check: ContactCheck,
): FinishingPoint | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= SAME_POINT_MM) return null;
  const length3d = Math.hypot(length, to.z - from.z);
  // Spaced along the move itself, so a steep move is checked as densely as a
  // level one: the contact curves hardest where it rises steeply.
  const intervals = Math.max(2, Math.ceil(length3d / check.spacingMm));
  // The tolerance as a height under the contact: over cos(a) of the move.
  const found: Worst = {
    point: null,
    excess: (FINISHING_CONTACT_TOLERANCE_MM * length3d) / length,
  };
  const move = { from, to };
  for (let first = 1; first < intervals; first += CHECKS_PER_STRETCH) {
    const last = Math.min(intervals - 1, first + CHECKS_PER_STRETCH - 1);
    checkStretch(move, stretchTimes(first, last, intervals), check, found);
  }
  return found.point;
}

type Worst = { point: FinishingPoint | null; excess: number };
type Move = { readonly from: FinishingPoint; readonly to: FinishingPoint };

// Check times `first` to `last` of the move's intervals, in order, with the
// extra ones in the first or last interval when the stretch reaches it.
function stretchTimes(first: number, last: number, intervals: number): number[] {
  const times: number[] = [];
  if (first === 1) for (const f of END_FRACTIONS) times.push(f / intervals);
  for (let step = first; step <= last; step += 1) times.push(step / intervals);
  if (last === intervals - 1) {
    for (let k = END_FRACTIONS.length - 1; k >= 0; k -= 1) {
      times.push(1 - (END_FRACTIONS[k] ?? 0) / intervals);
    }
  }
  return times;
}

// Checks the move at `times`, against only the elements that could rise above
// that stretch of it when the contact can say. Heights under the contact are
// compared, which on one move is the cut normal to it over a constant cos(a).
function checkStretch(
  move: Move,
  times: ReadonlyArray<number>,
  check: ContactCheck,
  found: Worst,
): void {
  const tipAt =
    check.alongMove === undefined
      ? check.tipAt
      : check.alongMove(
          pointAt(move, times[0] ?? 0),
          pointAt(move, times[times.length - 1] ?? 1),
          found.excess,
        );
  if (tipAt === null) return;
  for (const t of times) {
    const { x, y, z } = pointAt(move, t);
    // Compared with the bound itself: the contact returns the bound unchanged
    // when nothing reaches above it.
    const bound = z + found.excess;
    const tip = tipAt(x, y, bound);
    if (tip > bound) {
      found.excess = tip - z;
      found.point = { x, y, z: tip };
    }
  }
}

function pointAt(move: Move, t: number): FinishingPoint {
  return {
    x: move.from.x + t * (move.to.x - move.from.x),
    y: move.from.y + t * (move.to.y - move.from.y),
    z: move.from.z + t * (move.to.z - move.from.z),
  };
}
