// The centerline accuracy metric — the executable bar. Given a trace's output
// polylines and a ground-truth fixture, it reports:
//   - deviation (traced -> truth): how far off-center the trace runs, in source
//     px. A spur inflates this too (its tip is far from the true center), so a
//     low max deviation means both well-centered AND spur-free.
//   - gap (truth -> traced): uncovered stretches of the true stroke — i.e.
//     breaks / dropped segments.
//   - fragmentCount vs expectedStrokeCount: did strokes stay connected through
//     junctions, or shatter?
//   - shortFragmentCount: polylines shorter than a stroke width — a spur/stub
//     proxy.
//
// Pure, deterministic, test-only.

import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';
import { minDistanceToPolylines, polylineLength, sampleByArcLength } from './centerline-geometry';
import type { CenterlineTruthFixture } from './centerline-truth';

const SAMPLE_SPACING_PX = 0.5;

export type CenterlineDeviation = {
  readonly maxDeviationPx: number;
  readonly meanDeviationPx: number;
  readonly maxGapPx: number;
  readonly meanGapPx: number;
  readonly fragmentCount: number;
  readonly expectedStrokeCount: number;
  readonly shortFragmentCount: number;
};

function allPolylines(paths: ReadonlyArray<ColoredPath>): Polyline[] {
  const out: Polyline[] = [];
  for (const path of paths) {
    for (const pl of path.polylines) out.push(pl);
  }
  return out;
}

// One-directional sampled distance: every sample of `from` to its nearest
// segment in `to`. Returns [max, mean]; mean is 0 when there is nothing to
// sample.
function directedDistance(
  from: ReadonlyArray<Polyline>,
  to: ReadonlyArray<Polyline>,
): [number, number] {
  let max = 0;
  let sum = 0;
  let count = 0;
  for (const pl of from) {
    for (const s of sampleByArcLength(pl.points, SAMPLE_SPACING_PX)) {
      const d = minDistanceToPolylines(s, to);
      if (d > max) max = d;
      sum += d;
      count += 1;
    }
  }
  return [max, count > 0 ? sum / count : 0];
}

// The tip contract: a traced stroke ends at the visible INK tip (the round
// cap's apex, strokeWidth/2 beyond the analytic segment end), not at the
// segment end — stopping short reads as a retracted, stubby stroke. The
// analytic truths are segment definitions, so extend each open end by the cap
// radius before measuring. This makes deviation tolerate apex-reaching tips
// AND makes gap REQUIRE them.
function extendOpenEnds(polylines: ReadonlyArray<Polyline>, capRadius: number): Polyline[] {
  return polylines.map((pl) => {
    if (pl.closed || pl.points.length < 2) return pl;
    const first = pl.points[0];
    const second = pl.points[1];
    const last = pl.points.at(-1);
    const beforeLast = pl.points.at(-2);
    if (!first || !second || !last || !beforeLast) return pl;
    const start = stepBeyond(first, second, capRadius);
    const end = stepBeyond(last, beforeLast, capRadius);
    return { ...pl, points: [start, ...pl.points, end] };
  });
}

function stepBeyond(tip: Vec2, inner: Vec2, distance: number): Vec2 {
  const len = Math.hypot(tip.x - inner.x, tip.y - inner.y) || 1;
  return {
    x: tip.x + ((tip.x - inner.x) / len) * distance,
    y: tip.y + ((tip.y - inner.y) / len) * distance,
  };
}

export function measureCenterlineDeviation(
  traced: ReadonlyArray<ColoredPath>,
  truth: CenterlineTruthFixture,
): CenterlineDeviation {
  const tracedLines = allPolylines(traced);
  const cappedTruth = extendOpenEnds(truth.centerlines, truth.strokeWidthPx / 2);
  const [maxDeviationPx, meanDeviationPx] = directedDistance(tracedLines, cappedTruth);
  const [maxGapPx, meanGapPx] = directedDistance(cappedTruth, tracedLines);
  let shortFragmentCount = 0;
  for (const pl of tracedLines) {
    if (polylineLength(pl.points) < truth.strokeWidthPx) shortFragmentCount += 1;
  }
  return {
    maxDeviationPx,
    meanDeviationPx,
    maxGapPx,
    meanGapPx,
    fragmentCount: tracedLines.length,
    expectedStrokeCount: truth.expectedStrokeCount,
    shortFragmentCount,
  };
}
