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

const EPS = 1e-9;
/** Through cut each automatic window leaves before the next one. */
export const MIN_THROUGH_SPAN_MM = 0.1;
const PHASE_SAMPLES = 48;
const NUDGE_STEPS = 24;
// Chord lost to a flattened curve's facets, not to a corner.
const SCORE_TOLERANCE_MM = 0.01;

export type TabLoop = {
  readonly points: ReadonlyArray<Vec2>;
  /** Arc length to each vertex; the last entry is the perimeter. */
  readonly cumulative: ReadonlyArray<number>;
  readonly perimeter: number;
};

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

/** The closed loop `points` describe, or null when it has no length. */
export function tabLoop(rawPoints: ReadonlyArray<Vec2>): TabLoop | null {
  const points = closedLoopPoints(rawPoints);
  if (points.length < 3) return null;
  const cumulative: number[] = [0];
  for (let index = 1; index <= points.length; index += 1) {
    const previous = points[index - 1] as Vec2;
    const current = points[index % points.length] as Vec2;
    cumulative.push(
      (cumulative[index - 1] as number) +
        Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  const perimeter = cumulative[cumulative.length - 1] ?? 0;
  return perimeter > EPS ? { points, cumulative, perimeter } : null;
}

export function pointAtDistance(loop: TabLoop, distance: number): Vec2 {
  const { points, cumulative, perimeter } = loop;
  const target = modulo(distance, perimeter);
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((cumulative[middle] as number) < target) low = middle + 1;
    else high = middle;
  }
  const from = cumulative[low - 1] as number;
  const span = (cumulative[low] as number) - from;
  const ratio = span <= EPS ? 0 : (target - from) / span;
  const a = points[low - 1] as Vec2;
  const b = points[low % points.length] as Vec2;
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

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
    narrowestBridgeMm: narrowestBridge(loop, centers, windowMm, cutWidthMm),
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
    narrowestBridgeMm: merged.reduce<number | null>((narrowest, window) => {
      const bridge = bridgeAcross(loop, window.start, window.end, cutWidthMm);
      return narrowest === null || bridge < narrowest ? bridge : narrowest;
    }, null),
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

function narrowestBridge(
  loop: TabLoop,
  centers: ReadonlyArray<number>,
  windowMm: number,
  cutWidthMm: number,
): number | null {
  let narrowest: number | null = null;
  for (const center of centers) {
    const bridge = bridgeAcross(loop, center - windowMm / 2, center + windowMm / 2, cutWidthMm);
    if (narrowest === null || bridge < narrowest) narrowest = bridge;
  }
  return narrowest;
}

const BRIDGE_SAMPLES = 24;

// The material left between the cuts either side of a window: the distance
// from each kerf end to the cut running on from the other end, less the cut
// width. On a straight span that is the chord; where the outline closes in on
// itself, as round an acute tip, the far leg's cut comes nearer than its end.
function bridgeAcross(loop: TabLoop, start: number, end: number, cutWidthMm: number): number {
  const span = Math.max(cutWidthMm, end - start);
  const reach = Math.min(span, (loop.perimeter - (end - start)) / 2);
  const a = pointAtDistance(loop, start);
  const b = pointAtDistance(loop, end);
  let nearest = Math.hypot(b.x - a.x, b.y - a.y);
  for (let step = 1; step <= BRIDGE_SAMPLES; step += 1) {
    const along = (reach * step) / BRIDGE_SAMPLES;
    const beyondEnd = pointAtDistance(loop, end + along);
    const beforeStart = pointAtDistance(loop, start - along);
    nearest = Math.min(
      nearest,
      Math.hypot(beyondEnd.x - a.x, beyondEnd.y - a.y),
      Math.hypot(beforeStart.x - b.x, beforeStart.y - b.y),
    );
  }
  return nearest - cutWidthMm;
}

type Interval = { readonly start: number; readonly end: number };

// The windows as unwrapped arc-length intervals with overlaps merged, or
// 'whole' when together they cover the loop.
function mergedWindows(
  centers: ReadonlyArray<number>,
  windowMm: number,
  perimeter: number,
): ReadonlyArray<Interval> | 'whole' {
  if (centers.length === 0) return [];
  if (windowMm >= perimeter - EPS) return 'whole';
  const sorted = centers
    .map((center) => ({ start: center - windowMm / 2, end: center + windowMm / 2 }))
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && window.start <= last.end + EPS) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, window.end) };
    } else {
      merged.push(window);
    }
  }
  const first = merged[0] as Interval;
  const last = merged[merged.length - 1] as Interval;
  if (merged.length > 1 && last.end + EPS >= first.start + perimeter) {
    merged[0] = { start: last.start, end: first.end + perimeter };
    merged.pop();
  }
  const only = merged[0] as Interval;
  return merged.length === 1 && only.end - only.start >= perimeter - EPS ? 'whole' : merged;
}

function circularGap(a: number, b: number, period: number): number {
  const gap = modulo(a - b, period);
  return Math.min(gap, period - gap);
}

// Drop a trailing vertex that repeats the first: callers hand us rings both with
// and without the explicit closing point.
function closedLoopPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  if (points.length < 2) return points;
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  const repeatsFirst = Math.abs(first.x - last.x) <= EPS && Math.abs(first.y - last.y) <= EPS;
  return repeatsFirst ? points.slice(0, -1) : points;
}

export function modulo(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0;
  return ((value % divisor) + divisor) % divisor;
}
