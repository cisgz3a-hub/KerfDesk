// fair-stroke-font — smooths polyline-digitized stroke-font glyphs into
// G1 cubic curves using the trace engine's deterministic Schneider fitter
// (fairLineCurvePath, the same engine the pen tool's drawing fairing uses).
//
// The EMS faces (Nixish, Decorous Script, Casual Hand) are digitized as
// coarse line chains — their source SVGs carry thousands of L commands and
// almost no curves — so rendered text turns at every vertex and script
// letters look angular. Fairing fits smooth cubics through those chains
// while pinning genuine corners (hard turns >= 60 deg without a curving
// continuation) and both endpoints of every open stroke, so letterforms
// keep their drawn joints and only the sampled curvature evens out.
//
// Relief SingleLine is authored geometry (native cubics plus intentional
// straight strokes) and must not be re-fit; callers gate with
// isPolylineDigitizedFont before applying this pass.
//
// Pure core — deterministic, no I/O.

import { fairLineCurvePath } from '../geometry';
import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import type { StrokeFont, StrokeFontGlyph } from './stroke-font-text';

// Faces whose pinned source data is line-chain digitized (see the command
// census in fair-stroke-font.test.ts). Relief stays native.
const POLYLINE_DIGITIZED_FONT_KEYS: ReadonlySet<string> = new Set([
  'ems-nixish',
  'ems-decorous-script',
  'ems-casual-hand',
]);

// Fit tolerance scales with each stroke's own size (matches the drawing
// fairing ratio in create-polyline.ts) and is clamped relative to the
// font's cap height so tiny ticks are not over-smoothed and long
// flourishes cannot wander visibly off the digitized chain.
const FIT_TOLERANCE_RATIO = 0.02;
const MIN_FIT_TOLERANCE_CAP_RATIO = 0.006;
const MAX_FIT_TOLERANCE_CAP_RATIO = 0.02;

// A pen-reversal cusp (e.g. the switchback atop Decorous Script's J turns
// 172 deg at one vertex) must never be smoothed — the fitter's curving-
// continuation rule would otherwise un-pin it and grow a tiny self-
// intersecting loop. Digitized curves, including tight tail loops, top out
// near 60 deg per vertex, so splitting at 100 deg cleanly separates the two:
// runs are faired independently and rejoined, keeping the cusp exact.
const CUSP_SPLIT_TURN_DEG = 100;
const NEAR_POINT_EPS = 1e-9;

// The Schneider fitter is built for the tracer's DENSE chains; on a sparse
// font chain (3-9 points per stroke) its least-squares arms can overshoot
// into self-intersecting loops that the between-vertex error check never
// samples. Densifying with collinear midpoints changes no geometry but
// stabilizes the arms and lets the fit error see the whole span. The step
// is tied to the fit tolerance so density tracks smoothing scale.
const DENSIFY_STEP_TOLERANCE_RATIO = 2.5;

/** True when the bundled face is line-chain digitized and needs fairing. */
export function isPolylineDigitizedFont(fontKey: string): boolean {
  return POLYLINE_DIGITIZED_FONT_KEYS.has(fontKey);
}

/** Fairs every line-only glyph stroke into smooth G1 cubic paths. */
export function fairStrokeFont(font: StrokeFont): StrokeFont {
  return {
    ...font,
    glyphs: new Map(
      Array.from(font.glyphs, ([character, glyph]): [string, StrokeFontGlyph] => [
        character,
        fairGlyph(glyph, font.capHeight),
      ]),
    ),
  };
}

function fairGlyph(glyph: StrokeFontGlyph, capHeight: number): StrokeFontGlyph {
  return {
    ...glyph,
    paths: glyph.paths.map((path) => fairStrokePath(path, capHeight)),
  };
}

function fairStrokePath(path: CurveSubpath, capHeight: number): CurveSubpath {
  // fairLineCurvePath returns mixed-segment and short paths unchanged, so
  // authored cubics and 2-3 point ticks pass straight through; splitting is
  // only meaningful on the open line chains the EMS data is made of.
  if (path.closed || path.segments.some((segment) => segment.kind !== 'line')) {
    return fairLineCurvePath(path, { fitToleranceUnits: fitTolerance(path, capHeight) });
  }
  // Fewer than 4 original points is a tick or a plain angle, not a sampled
  // curve — keep it byte-identical instead of densifying it into a fit.
  if (path.segments.length < 3) return path;
  const tolerance = fitTolerance(path, capHeight);
  const runs = splitAtCusps(path).map((run) =>
    fairLineCurvePath(densify(run, tolerance * DENSIFY_STEP_TOLERANCE_RATIO), {
      fitToleranceUnits: tolerance,
    }),
  );
  const first = runs[0];
  if (first === undefined) return path;
  // The fitter interpolates run endpoints exactly, so rejoining keeps one
  // continuous machining stroke with the cusp vertex bit-identical.
  return {
    start: first.start,
    closed: false,
    segments: runs.flatMap((run) => run.segments),
  };
}

function densify(run: CurveSubpath, maxStep: number): CurveSubpath {
  let current = run.start;
  const segments = run.segments.flatMap((segment) => {
    const from = current;
    current = segment.to;
    if (segment.kind !== 'line') return [segment];
    const length = Math.hypot(segment.to.x - from.x, segment.to.y - from.y);
    const pieces = Math.max(1, Math.ceil(length / maxStep));
    return Array.from({ length: pieces }, (_, index): PathSegment => {
      const t = (index + 1) / pieces;
      // Emit the original endpoint object so corner pinning by reference
      // and cusp joints stay bit-identical.
      if (index + 1 === pieces) return segment;
      return {
        kind: 'line',
        to: { x: from.x + (segment.to.x - from.x) * t, y: from.y + (segment.to.y - from.y) * t },
      };
    });
  });
  return { ...run, segments };
}

function splitAtCusps(path: CurveSubpath): CurveSubpath[] {
  const points = [path.start, ...path.segments.map((segment) => segment.to)];
  const cuspRad = (CUSP_SPLIT_TURN_DEG * Math.PI) / 180;
  const bounds = [0];
  for (let index = 1; index + 1 < points.length; index += 1) {
    if (turnAt(points, index) >= cuspRad) bounds.push(index);
  }
  bounds.push(points.length - 1);
  const runs: CurveSubpath[] = [];
  for (let b = 0; b + 1 < bounds.length; b += 1) {
    const from = bounds[b] ?? 0;
    const to = bounds[b + 1] ?? points.length - 1;
    const start = points[from];
    if (to <= from || start === undefined) continue;
    runs.push({
      start,
      closed: false,
      segments: points.slice(from + 1, to + 1).map((point) => ({ kind: 'line', to: point })),
    });
  }
  return runs;
}

function turnAt(points: ReadonlyArray<Vec2>, index: number): number {
  const previous = points[index - 1];
  const at = points[index];
  const next = points[index + 1];
  if (previous === undefined || at === undefined || next === undefined) return 0;
  const inLength = Math.hypot(at.x - previous.x, at.y - previous.y);
  const outLength = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLength < NEAR_POINT_EPS || outLength < NEAR_POINT_EPS) return 0;
  const dot =
    ((at.x - previous.x) / inLength) * ((next.x - at.x) / outLength) +
    ((at.y - previous.y) / inLength) * ((next.y - at.y) / outLength);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function fitTolerance(path: CurveSubpath, capHeight: number): number {
  let minX = path.start.x;
  let minY = path.start.y;
  let maxX = path.start.x;
  let maxY = path.start.y;
  for (const segment of path.segments) {
    minX = Math.min(minX, segment.to.x);
    minY = Math.min(minY, segment.to.y);
    maxX = Math.max(maxX, segment.to.x);
    maxY = Math.max(maxY, segment.to.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  return Math.max(
    capHeight * MIN_FIT_TOLERANCE_CAP_RATIO,
    Math.min(capHeight * MAX_FIT_TOLERANCE_CAP_RATIO, diagonal * FIT_TOLERANCE_RATIO),
  );
}
