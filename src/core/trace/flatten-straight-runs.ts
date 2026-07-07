// Curvature-safe straightening of near-straight runs in a traced chain.
//
// Rough source edges leave low-amplitude, long-wavelength waviness that
// survives both Taubin evening (local) and Douglas-Peucker (keeps anything
// over ε): a nominally straight letter stem traces wobbly. A qualifying run
// is replaced by its TOTAL-LEAST-SQUARES line, not by the chord between its
// two (noisy) end vertices — a chord endpoint sitting at a wobble extreme
// tilts the whole replacement (measured on the jittered-bar instrument:
// chord replacement RAISED edge waviness 0.65 → 0.93px RMS), while the TLS
// fit averages the noise away.
//
// Wobble and genuine curvature are separated by THREE gates, not by
// amplitude alone: (1) chord-side balance — noise deviates on both sides of
// the run's chord in comparable shares, while an arc's sagitta bow is
// one-sided at ANY radius (the scale-free guard for gentle big-radius
// curves); (2) model comparison — a straight-line fit explains noise about
// as well as a quadratic arc does, while a genuine arc is explained
// dramatically better by the quadratic; (3) amplitude — runs above the cap
// are feature geometry and are never touched.
//
// Replacement endpoints: corner vertices and chain endpoints are pinned —
// they keep their exact object (downstream pins corners by reference) and
// never move. A joint shared by two adjacent runs snaps to the intersection
// of their fitted lines (recovering the true apex of a soft bend), falling
// back to the projection midpoint when the fits are near-parallel. Any other
// run endpoint projects onto its own fitted line.

import type { Vec2 } from '../scene';
import {
  fitLineThroughRun,
  quadraticFitFromStats,
  runFrameStats,
  type FitLine,
} from './run-fit';

// A run must be at least this long to flatten — protects small-glyph detail:
// a 1px amplitude cap is heavy-handed on a 10px letter stem (measured on the
// LANGEBAAN band: 8px let letter edges flatten, band IoU 0.938 → 0.918),
// while the reported wobbly straight lines are tens of pixels long.
const MIN_RUN_LENGTH_PX = 14;
// ... and carry at least this many vertices: a 3-4 point fit inherits the
// local noise trend and emits a TILTED segment (measured on the jittered-bar
// instrument), so short runs stay untouched until more evidence accumulates.
const MIN_RUN_POINTS = 5;
// Residuals may exceed the amplitude cap in a gray zone up to this factor,
// as long as they stay RARE (extreme-value tail of genuine noise). Anything
// beyond it is feature geometry and breaks the run immediately.
const HARD_BREAK_FACTOR = 1.4;
// Largest tolerated share of gray-zone residuals within one run.
const OUTLIER_FRACTION = 0.05;
// Baseline wobble amplitude the flattener may erase at maxDeviationPx = 1.
// Deliberately conservative: hand-drawn art (waves, hatching) oscillates at
// the same amplitude as edge noise, so aggressiveness is a CALLER choice
// (the trace dialog's Smoothness knob), not a constant.
const BASE_MAX_DEVIATION_PX = 1.0;
// Below this the flattener is effectively off; skip the scan.
const MIN_ACTIVE_DEVIATION_PX = 0.2;
// The line model may lose to the quadratic-arc model by this factor and
// still count as straight: an unbiased-noise run fits the quadratic slightly
// better purely from its extra parameters, while a genuine arc fits it far
// better than this slack.
const LINE_VS_ARC_TOLERANCE = 1.5;
// Chord-side balance: noise deviates on BOTH sides of the run's chord in
// comparable shares, while an arc's sagitta bow is one-sided at ANY radius —
// the scale-free guard for gentle large-radius curves, whose within-window
// sagitta is too small for the quadratic model to win (measured: without
// this gate the flattener chopped secants across the arch-house curves,
// IoU 0.963 → 0.921). Runs whose minority side falls below this share of
// the significant deviations are arcs. Zero-mean noise splits ~40/60 or
// better; a noisy shallow arc rarely reaches a third on its minority side.
const MIN_SIDE_BALANCE = 0.32;
// Chord deviations under this are noise-floor and count for neither side.
const MIN_OSCILLATION_PX = 0.15;
// Absolute slack for effectively-perfect lines (quadRms ≈ 0 on clean input
// must not read as "the arc model wins").
const FLAT_LINE_SLACK_PX = 0.02;
// A joint may snap to the intersection of its two fitted lines only within
// this distance of the original vertex; near-parallel fits intersect far
// away and fall back to the projection midpoint.
const JOINT_SNAP_LIMIT_PX = 2;
// Direction cross-products under this magnitude are parallel lines.
const PARALLEL_EPS = 1e-6;

/** Replace near-straight vertex runs with their total-least-squares line.
 *  Corner vertices and chain endpoints are never moved (they may terminate a
 *  run, never sit inside one). For a closed chain the scan starts at the
 *  vertex farthest from the centroid — the same anchor choice the simplifier
 *  makes — so the seam does not split a straight run in the common case.
 *  `strength` scales the amplitude the flattener may erase (1 = the
 *  conservative baseline; 0 disables). */
export function flattenStraightRuns(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  strength = 1,
): Vec2[] {
  const maxDeviationPx = BASE_MAX_DEVIATION_PX * Math.max(0, strength);
  if (points.length < 4 || maxDeviationPx < MIN_ACTIVE_DEVIATION_PX) return [...points];
  const ring = closed ? rotateToFarthest(points) : [...points];
  // OPEN chain endpoints are pinned like corners (they are real geometry).
  // A closed ring's seam anchor is NOT: it is an arbitrary bookkeeping
  // vertex — and rotateToFarthest picks the farthest-from-centroid point,
  // which on a noisy ring is by construction the worst noise outlier.
  // Pinning it froze that outlier into every output (measured on the
  // jittered-ring instrument); instead the seam is merged positionally on
  // the way out.
  const pinned = new Set(corners);
  if (!closed) {
    pinned.add(ring[0] as Vec2);
    pinned.add(ring[ring.length - 1] as Vec2);
  }
  const runs = collectWobbleRuns(ring, corners, maxDeviationPx);
  const out = emitWithFittedRuns(ring, runs, pinned);
  return closed ? mergeRingSeam(out, corners) : out;
}

// Restore the no-repeated-first-point ring convention: the rotated ring
// carries its anchor at both ends. When both ends emitted the same object,
// pop the duplicate; when the two runs bounding the seam each projected the
// anchor slightly differently, merge the near-coincident pair at their
// midpoint (never moving a corner object).
const SEAM_MERGE_PX = 1.0;

function mergeRingSeam(out: Vec2[], corners: ReadonlySet<Vec2>): Vec2[] {
  if (out.length < 2) return out;
  const first = out[0] as Vec2;
  const last = out[out.length - 1] as Vec2;
  if (first === last) {
    out.pop();
    return out;
  }
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  if (gap < SEAM_MERGE_PX && !corners.has(first) && !corners.has(last)) {
    out[0] = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    out.pop();
  }
  return out;
}

type WobbleRun = {
  readonly start: number;
  readonly end: number;
  readonly line: FitLine;
};

// Greedy, in index order: extend each candidate run as far as classification
// allows. Runs never overlap; two adjacent runs may share their boundary
// vertex (a soft bend between two straights).
function collectWobbleRuns(
  ring: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  maxDeviationPx: number,
): WobbleRun[] {
  const runs: WobbleRun[] = [];
  let i = 0;
  while (i < ring.length - 1) {
    const j = longestFlattenableRunEnd(ring, i, corners, maxDeviationPx);
    if (j > i + 1) {
      runs.push({ start: i, end: j, line: fitLineThroughRun(ring, i, j) });
      i = j;
    } else {
      i += 1;
    }
  }
  return runs;
}

// Extend the run while the straight-line model holds: no corner strictly
// inside, residuals within the amplitude cap (rare gray-zone extremes
// tolerated), and neither arc gate winning. Returns the end index of the
// longest qualifying run of at least MIN_RUN_LENGTH_PX and MIN_RUN_POINTS,
// or start (no run).
function longestFlattenableRunEnd(
  ring: ReadonlyArray<Vec2>,
  start: number,
  corners: ReadonlySet<Vec2>,
  maxDeviationPx: number,
): number {
  let best = start;
  for (let end = start + 2; end < ring.length; end += 1) {
    const interior = ring[end - 1] as Vec2;
    if (corners.has(interior)) break;
    const shape = classifyRun(ring, start, end, maxDeviationPx);
    if (shape === 'too-bumpy') break;
    if (shape !== 'flatten') continue;
    if (end - start + 1 < MIN_RUN_POINTS) continue;
    if (chordLength(ring[start] as Vec2, ring[end] as Vec2) >= MIN_RUN_LENGTH_PX) best = end;
  }
  return best;
}

function classifyRun(
  ring: ReadonlyArray<Vec2>,
  start: number,
  end: number,
  maxDeviationPx: number,
): 'too-bumpy' | 'arc' | 'flatten' {
  const line = fitLineThroughRun(ring, start, end);
  const stats = runFrameStats(ring, start, end, line, maxDeviationPx);
  const n = end - start + 1;
  // A residual beyond the gray zone is feature geometry; gray-zone residuals
  // (cap .. 1.4×cap) are tolerated while they stay rare — breaking a long
  // run at every extreme-value noise vertex fragments it into short tilted
  // fits, which is worse than not flattening at all (measured).
  if (stats.maxAbsResidual > maxDeviationPx * HARD_BREAK_FACTOR) return 'too-bumpy';
  if (stats.overCapCount > Math.max(1, Math.ceil(n * OUTLIER_FRACTION))) return 'too-bumpy';
  const lineRms = Math.sqrt(stats.residualSumSq / n);
  if (lineRms <= FLAT_LINE_SLACK_PX) return 'flatten';
  if (chordMinoritySideShare(ring, start, end) < MIN_SIDE_BALANCE) return 'arc';
  // A degenerate quadratic system cannot masquerade as an arc: fall back to
  // the line RMS so the comparison is a wash and the amplitude gates decide.
  const quadRms = quadraticFitFromStats(stats, n)?.rms ?? lineRms;
  return lineRms <= quadRms * LINE_VS_ARC_TOLERANCE + FLAT_LINE_SLACK_PX ? 'flatten' : 'arc';
}

// Share of the significant chord deviations sitting on the minority side.
// Noise splits roughly evenly; an arc's bow is nearly all one side. Runs
// with no significant deviation at all read as balanced (clean straight).
function chordMinoritySideShare(ring: ReadonlyArray<Vec2>, start: number, end: number): number {
  const a = ring[start] as Vec2;
  const b = ring[end] as Vec2;
  let positive = 0;
  let negative = 0;
  for (let k = start + 1; k < end; k += 1) {
    const d = signedPerpendicularDistance(ring[k] as Vec2, a, b);
    if (d >= MIN_OSCILLATION_PX) positive += 1;
    else if (d <= -MIN_OSCILLATION_PX) negative += 1;
  }
  const total = positive + negative;
  if (total === 0) return 0.5;
  return Math.min(positive, negative) / total;
}

function signedPerpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < PARALLEL_EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  return ((p.x - a.x) * vy - (p.y - a.y) * vx) / Math.sqrt(lenSq);
}

// Emit the chain with each wobble run replaced by its fitted line: pinned
// boundary vertices stay exact, a shared joint snaps to the line-line
// intersection, every other run endpoint projects onto its own line, and
// run interiors are dropped.
function emitWithFittedRuns(
  ring: ReadonlyArray<Vec2>,
  runs: ReadonlyArray<WobbleRun>,
  pinned: ReadonlySet<Vec2>,
): Vec2[] {
  const out: Vec2[] = [];
  let runIdx = 0;
  let i = 0;
  while (i < ring.length) {
    const run = runs[runIdx];
    if (run === undefined || i < run.start) {
      out.push(ring[i] as Vec2);
      i += 1;
      continue;
    }
    out.push(runStartVertex(ring, runs, runIdx, pinned));
    i = run.end;
    runIdx += 1;
    const next = runs[runIdx];
    if (next !== undefined && next.start === i) continue; // joint: next run emits it
    const endVertex = ring[run.end] as Vec2;
    out.push(pinned.has(endVertex) ? endVertex : projectOntoLine(run.line, endVertex));
    i += 1;
  }
  return out;
}

// The vertex opening run `runIdx`: pinned stays exact; a joint shared with
// the previous run snaps to both lines' intersection; anything else projects
// onto this run's own line.
function runStartVertex(
  ring: ReadonlyArray<Vec2>,
  runs: ReadonlyArray<WobbleRun>,
  runIdx: number,
  pinned: ReadonlySet<Vec2>,
): Vec2 {
  const run = runs[runIdx] as WobbleRun;
  const vertex = ring[run.start] as Vec2;
  if (pinned.has(vertex)) return vertex;
  const prev = runIdx > 0 ? runs[runIdx - 1] : undefined;
  if (prev !== undefined && prev.end === run.start) return jointVertex(vertex, prev.line, run.line);
  return projectOntoLine(run.line, vertex);
}

// Intersection of the two fitted lines when it stays near the original
// vertex (the true apex of a soft bend); the projection midpoint otherwise —
// near-parallel lines intersect arbitrarily far away.
function jointVertex(vertex: Vec2, a: FitLine, b: FitLine): Vec2 {
  const p = intersectLines(a, b);
  if (p !== null && chordLength(p, vertex) <= JOINT_SNAP_LIMIT_PX) return p;
  const pa = projectOntoLine(a, vertex);
  const pb = projectOntoLine(b, vertex);
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

function intersectLines(a: FitLine, b: FitLine): Vec2 | null {
  const cross = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(cross) < PARALLEL_EPS) return null;
  const wx = b.px - a.px;
  const wy = b.py - a.py;
  const s = (wx * b.dy - wy * b.dx) / cross;
  return { x: a.px + s * a.dx, y: a.py + s * a.dy };
}

function projectOntoLine(line: FitLine, p: Vec2): Vec2 {
  const u = (p.x - line.px) * line.dx + (p.y - line.py) * line.dy;
  return { x: line.px + u * line.dx, y: line.py + u * line.dy };
}

function chordLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotateToFarthest(points: ReadonlyArray<Vec2>): Vec2[] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let anchor = 0;
  let bestDistSq = -1;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i] as Vec2;
    const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
    if (d > bestDistSq) {
      bestDistSq = d;
      anchor = i;
    }
  }
  return [...points.slice(anchor), ...points.slice(0, anchor), points[anchor] as Vec2];
}
