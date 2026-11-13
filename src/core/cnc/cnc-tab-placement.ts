// Where the holding tabs of one closed toolpath go (ADR-258 Amendment 5).
//
// A tab window is `tab width + cut width` long ALONG the toolpath, so the bridge
// left between the two kerf ends is the requested width only while the window
// lies on a straight span. Across a corner the kerf ends close in: the bridge is
// the window's chord less the cut width, (W + D)/sqrt(2) - D on a square corner,
// and it is gone once that reaches zero (CNC audit v3 N1-P2-1). Spacing tabs
// evenly from the seam put the default four on every corner of a square, since
// cut direction moves the seam to the middle of the longest edge.
//
// Automatic tabs therefore keep even spacing but pick the phase whose windows
// lose the least chord, preferring the one that sits furthest into straight
// runs, then the legacy half-spacing phase, so a curve keeps its old places. A
// tab still turning a corner is then nudged along its own span. A loop too
// short for the requested count gets as many tabs as leave it cutting through
// (J1-P1-1, AUDIT A5); one too short for even one rides the tab top whole.
//
// Pure: no clock, no randomness, no I/O.

import type { Vec2 } from '../scene';
import { narrowestBridgeMm } from './cnc-tab-bridge';
import {
  circularGap,
  mergedWindows,
  modulo,
  pointAtDistance,
  tabLoop,
  type TabLoop,
} from './cnc-tab-loop';

export { modulo, pointAtDistance, tabLoop, type TabLoop };

const EPS = 1e-9;
/** Through cut each automatic window leaves before the next one. */
export const MIN_THROUGH_SPAN_MM = 0.1;
const PHASE_SAMPLES = 48;
const NUDGE_STEPS = 24;
// Chord lost to a flattened curve's facets, not to a corner.
const SCORE_TOLERANCE_MM = 0.01;

export type TabPlan = {
  /** Window centres as arc length from the loop start. Empty when `coversLoop`. */
  readonly centers: ReadonlyArray<number>;
  readonly windowMm: number;
  /** The windows leave no span to cut through: the loop rides the tab top. */
  readonly coversLoop: boolean;
  /** Tabs asked for: tabs per shape, or the anchors placed by hand. */
  readonly requested: number;
  /** The narrowest bridge left: window chord less the cut width (null: none). */
  readonly narrowestBridgeMm: number | null;
};

/** Evenly spaced automatic tabs, kept off corners, as many as the loop holds. */
export function automaticTabPlan(
  loop: TabLoop,
  tabsPerShape: number,
  windowMm: number,
  cutWidthMm: number,
): TabPlan {
  const requested = Math.max(1, Math.floor(tabsPerShape));
  const fits = Math.min(
    requested,
    Math.floor((loop.perimeter + EPS) / (windowMm + MIN_THROUGH_SPAN_MM)),
  );
  if (fits < 1) return coveredPlan(windowMm, requested);
  const spacing = loop.perimeter / fits;
  const scorer = phaseScorer(loop, windowMm, spacing);
  const phase = bestPhase(loop, fits, spacing, windowMm, scorer);
  const reach = Math.max(0, (spacing - windowMm - MIN_THROUGH_SPAN_MM) / 2);
  const centers = Array.from({ length: fits }, (_, index) =>
    nudgedCenter(phase + index * spacing, reach, scorer),
  ).map((center) => modulo(center, loop.perimeter));
  return {
    centers,
    windowMm,
    coversLoop: false,
    requested,
    narrowestBridgeMm: windowsBridgeMm(loop, centers, windowMm, cutWidthMm),
  };
}

/**
 * Where automatic tabs fall on an outline, as fractions of its own length from
 * its first point (ADR-156 anchor positions), planned on `worldPoints`, the
 * outline as placed on the bed. "Edit positions" seeds these, so opening the
 * editor shows the tabs the job already cuts (CNC audit v3 N1-P3-2). An affine
 * transform keeps each point's segment and its place along it, so the
 * fraction carries back to `localPoints`.
 */
export function automaticTabFractions(
  localPoints: ReadonlyArray<Vec2>,
  worldPoints: ReadonlyArray<Vec2>,
  tabsPerShape: number,
  windowMm: number,
  cutWidthMm: number,
): ReadonlyArray<number> | null {
  const world = tabLoop(worldPoints);
  const local = tabLoop(localPoints);
  if (world === null || local === null || world.points.length !== local.points.length) return null;
  const plan = automaticTabPlan(world, tabsPerShape, windowMm, cutWidthMm);
  return plan.centers.map((center) => {
    let edge = 1;
    while (edge < world.cumulative.length - 1 && (world.cumulative[edge] as number) < center) {
      edge += 1;
    }
    const from = world.cumulative[edge - 1] as number;
    const span = (world.cumulative[edge] as number) - from;
    const ratio = span <= EPS ? 0 : (center - from) / span;
    const localFrom = local.cumulative[edge - 1] as number;
    const localSpan = (local.cumulative[edge] as number) - localFrom;
    return modulo((localFrom + ratio * localSpan) / local.perimeter, 1);
  });
}

/** Anchors placed by hand (ADR-156) as perimeter fractions, cut where they are. */
export function manualTabPlan(
  loop: TabLoop,
  fractions: ReadonlyArray<number>,
  windowMm: number,
  cutWidthMm: number,
): TabPlan {
  const centers = fractions
    .filter((fraction) => Number.isFinite(fraction))
    .map((fraction) => modulo(fraction, 1) * loop.perimeter);
  const merged = mergedWindows(centers, windowMm, loop.perimeter);
  if (merged === 'whole') return coveredPlan(windowMm, centers.length);
  return {
    centers,
    windowMm,
    coversLoop: false,
    requested: centers.length,
    narrowestBridgeMm: narrowestBridgeMm(loop, merged, cutWidthMm),
  };
}

function coveredPlan(windowMm: number, requested: number): TabPlan {
  return { centers: [], windowMm, coversLoop: true, requested, narrowestBridgeMm: null };
}

type Score = { readonly primary: number; readonly secondary: number };
type Scorer = (center: number) => Score;

// Primary: chord lost by the tab's own window. Secondary: chord lost by a
// longer window, so among windows that lose none the one deepest in its
// straight run wins (the middle of a square's edge, not just past a corner).
function phaseScorer(loop: TabLoop, windowMm: number, spacing: number): Scorer {
  const straightRunMm = Math.max(windowMm, Math.min(spacing, loop.perimeter / 4));
  return (center) => ({
    primary: chordDeficit(loop, center, windowMm),
    secondary: chordDeficit(loop, center, straightRunMm),
  });
}

function bestPhase(
  loop: TabLoop,
  count: number,
  spacing: number,
  windowMm: number,
  scorer: Scorer,
): number {
  const legacy = spacing / 2;
  let best = { phase: legacy, score: phaseScore(legacy, count, spacing, scorer) };
  for (const phase of candidatePhases(loop, spacing, windowMm)) {
    const score = phaseScore(phase, count, spacing, scorer);
    if (
      compareScores(score, best.score, count) < 0 ||
      (compareScores(score, best.score, count) === 0 &&
        circularGap(phase, legacy, spacing) < circularGap(best.phase, legacy, spacing) - EPS)
    ) {
      best = { phase, score };
    }
  }
  return best.phase;
}

// A spread of phases plus every one that centres a tab on a straight segment
// long enough to hold its whole window.
function candidatePhases(loop: TabLoop, spacing: number, windowMm: number): ReadonlyArray<number> {
  const phases = Array.from(
    { length: PHASE_SAMPLES },
    (_, index) => (index * spacing) / PHASE_SAMPLES,
  );
  for (let index = 1; index < loop.cumulative.length; index += 1) {
    const from = loop.cumulative[index - 1] as number;
    const to = loop.cumulative[index] as number;
    if (to - from >= windowMm - EPS) phases.push(modulo((from + to) / 2, spacing));
  }
  return phases;
}

function phaseScore(phase: number, count: number, spacing: number, scorer: Scorer): Score {
  let primary = 0;
  let secondary = 0;
  for (let index = 0; index < count; index += 1) {
    const score = scorer(phase + index * spacing);
    primary += score.primary;
    secondary += score.secondary;
  }
  return { primary, secondary };
}

function compareScores(a: Score, b: Score, count: number): number {
  const tolerance = SCORE_TOLERANCE_MM * Math.max(1, count);
  if (a.primary < b.primary - tolerance) return -1;
  if (a.primary > b.primary + tolerance) return 1;
  if (a.secondary < b.secondary - tolerance) return -1;
  if (a.secondary > b.secondary + tolerance) return 1;
  return 0;
}

// A tab whose window still turns a corner slides along its own share of the
// loop, never into a neighbour's, to the nearest place that loses the least.
function nudgedCenter(center: number, reach: number, scorer: Scorer): number {
  const start = scorer(center);
  if (start.primary <= SCORE_TOLERANCE_MM || reach <= EPS) return center;
  let best = { center, score: start };
  for (let step = 1; step <= NUDGE_STEPS; step += 1) {
    for (const sign of [1, -1]) {
      const candidate = center + (sign * reach * step) / NUDGE_STEPS;
      const score = scorer(candidate);
      if (compareScores(score, best.score, 1) < 0) best = { center: candidate, score };
    }
  }
  return best.center;
}

function chordDeficit(loop: TabLoop, center: number, lengthMm: number): number {
  const half = lengthMm / 2;
  return Math.max(0, lengthMm - chordBetween(loop, center - half, center + half));
}

function chordBetween(loop: TabLoop, from: number, to: number): number {
  const a = pointAtDistance(loop, from);
  const b = pointAtDistance(loop, to);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The narrowest bridge evenly placed windows leave (cnc-tab-bridge.ts). */
export function windowsBridgeMm(
  loop: TabLoop,
  centers: ReadonlyArray<number>,
  windowMm: number,
  cutWidthMm: number,
): number | null {
  const windows = mergedWindows(centers, windowMm, loop.perimeter);
  return windows === 'whole' ? null : narrowestBridgeMm(loop, windows, cutWidthMm);
}
