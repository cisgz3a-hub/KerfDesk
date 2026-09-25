import { isDeepStrictEqual } from 'node:util';
import { compilationPolylines } from '../core/job/compilation-polylines';
import type { ColoredPath, CurveSubpath, Polyline, Transform, Vec2 } from '../core/scene';
import { traceCommitTopology, type TraceCommitTopology } from './trace-commit-topology';

// Independent acceptance constants from ADR-391, rather than the production
// simplifier's exported settings. Changing the output policy must update this oracle.
const TOLERANCE_MM = 0.025;
const NUMERIC_EPSILON_MM = 1e-10;
const MAX_ISSUES = 20;

export type TraceCommitFidelity = {
  issues: string[];
  sourcePolylines: number;
  committedPolylines: number;
  sourceVertices: number;
  committedVertices: number;
  preservedNativeCurves: number;
  retainedHardCorners: number;
  maximumDeviationBoundMm: number;
  topology: TraceCommitTopology;
};

type Probe = Omit<TraceCommitFidelity, 'topology'>;

/** Check the saved laser trace against its worker preview without running the
 * production conditioner. Fitted canonical curves must remain exact. Straight
 * chains must retain their own ordered vertices, ends, seams and hard corners.
 * Each replaced subchain is confined to its chord's 0.025 mm corridor. Since
 * its ends lie on that chord and the subchain is continuous, this also bounds
 * the reverse distance from the entire chord to the subchain, not only vertices. */
export function traceCommitFidelity(
  source: readonly ColoredPath[],
  saved: readonly ColoredPath[],
  placement: Transform,
): TraceCommitFidelity {
  const probe: Probe = {
    issues: [],
    sourcePolylines: source.reduce((sum, path) => sum + path.polylines.length, 0),
    committedPolylines: saved.reduce((sum, path) => sum + path.polylines.length, 0),
    sourceVertices: vertices(source),
    committedVertices: vertices(saved),
    preservedNativeCurves: 0,
    retainedHardCorners: 0,
    maximumDeviationBoundMm: 0,
  };
  if (source.length !== saved.length) issue(probe, 'Colored path count changed');
  source.forEach((path, index) => checkPath(path, saved[index], placement, probe, index));
  // Count/finite checks run first, so a lost contour cannot be hidden by pairing
  // later contours and malformed geometry never reaches the topology predicates.
  const topology =
    probe.issues.length === 0
      ? traceCommitTopology(
          source.flatMap((path) => compilationPolylines(path, placement)),
          saved.flatMap((path) => compilationPolylines(path, placement)),
        )
      : traceCommitTopology([], []);
  for (const [key, value] of Object.entries(topology)) {
    if (key !== 'closedLoops' && value !== 0) issue(probe, `Topology ${key}: ${String(value)}`);
  }
  return { ...probe, topology };
}

function vertices(paths: readonly ColoredPath[]): number {
  return paths.reduce(
    (sum, path) => sum + path.polylines.reduce((n, line) => n + line.points.length, 0),
    0,
  );
}

function issue(probe: Probe, message: string): void {
  if (probe.issues.length < MAX_ISSUES) probe.issues.push(message);
}

function checkPath(
  source: ColoredPath,
  saved: ColoredPath | undefined,
  placement: Transform,
  probe: Probe,
  index: number,
): void {
  if (saved === undefined) return issue(probe, `Path ${String(index)} missing`);
  const { polylines: _sourceLines, curves: _sourceCurves, ...sourceMetadata } = source;
  const { polylines: _savedLines, curves: _savedCurves, ...savedMetadata } = saved;
  if (!isDeepStrictEqual(sourceMetadata, savedMetadata))
    issue(probe, `Path ${String(index)} metadata changed`);
  if (source.polylines.length !== saved.polylines.length)
    issue(probe, `Path ${String(index)} contour count changed`);
  if (saved.curves !== undefined && saved.curves.length !== saved.polylines.length) {
    issue(probe, `Path ${String(index)} unpaired canonical curves`);
  }
  source.polylines.forEach((line, subpath) => {
    const target = saved.polylines[subpath];
    const label = `Path ${String(index)}, contour ${String(subpath)}`;
    if (target === undefined) return issue(probe, `${label} missing`);
    if (
      target.points.length < 2 ||
      target.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    ) {
      return issue(probe, `${label} empty or non-finite`);
    }
    const curve = source.curves?.[subpath];
    if (curve?.segments.some((segment) => segment.kind !== 'line')) {
      checkNativeCurve(curve, saved.curves?.[subpath], target, placement, probe, label);
      return;
    }
    if (saved.curves !== undefined && !sameLinearCurve(target, saved.curves[subpath])) {
      issue(probe, `${label} canonical curve differs from its straight polyline`);
    }
    checkStraight(
      curve === undefined
        ? line
        : { points: [curve.start, ...curve.segments.map((s) => s.to)], closed: curve.closed },
      target,
      placement,
      probe,
      label,
    );
  });
}

function sameLinearCurve(line: Polyline, curve: CurveSubpath | undefined): boolean {
  return (
    curve !== undefined &&
    isDeepStrictEqual(curve, {
      start: line.points[0],
      closed: line.closed,
      segments: line.points.slice(1).map((to) => ({ kind: 'line', to })),
    })
  );
}

function checkNativeCurve(
  source: CurveSubpath,
  saved: CurveSubpath | undefined,
  line: Polyline,
  placement: Transform,
  probe: Probe,
  label: string,
): void {
  if (!isDeepStrictEqual(source, saved))
    return issue(probe, `${label} fitted canonical curve changed`);
  probe.preservedNativeCurves += 1;
  // Canonical identity is checked above independently of flattening. This
  // additional check observes the actual compile representation of that curve.
  const [compiled] = compilationPolylines(
    { color: '#000000', curves: [source], polylines: [] },
    placement,
  );
  if (!isDeepStrictEqual(compiled, line))
    issue(probe, `${label} compatibility polyline differs from compile`);
}

function checkStraight(
  source: Polyline,
  saved: Polyline,
  placement: Transform,
  probe: Probe,
  label: string,
): void {
  if (source.closed !== saved.closed) return issue(probe, `${label} closure changed`);
  if (
    saved.closed &&
    new Set(saved.points.map((point) => `${String(point.x)},${String(point.y)}`)).size < 3
  ) {
    issue(probe, `${label} closed mark collapsed`);
  }
  const kept = subsequence(source.points, saved.points);
  if (kept === null)
    return issue(probe, `${label} vertices/ends/seam are not an ordered source subsequence`);
  const physical = source.points.map((point) => ({
    x: point.x * Math.abs(placement.scaleX),
    y: point.y * Math.abs(placement.scaleY),
  }));
  for (let index = 1; index < kept.length; index += 1) {
    const from = kept[index - 1] as number;
    const to = kept[index] as number;
    for (let at = from; at <= to; at += 1) {
      probe.maximumDeviationBoundMm = Math.max(
        probe.maximumDeviationBoundMm,
        distanceToChord(physical[at] as Vec2, physical[from] as Vec2, physical[to] as Vec2),
      );
    }
  }
  if (probe.maximumDeviationBoundMm > TOLERANCE_MM + NUMERIC_EPSILON_MM)
    issue(probe, `${label} exceeds ${String(TOLERANCE_MM)} mm deviation`);
  checkCorners(source.points, physical, new Set(kept), probe, label);
}

function same(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
}

function subsequence(source: readonly Vec2[], saved: readonly Vec2[]): number[] | null {
  if (!same(source[0], saved[0]) || !same(source.at(-1), saved.at(-1))) return null;
  const result = [0];
  let cursor = 1;
  for (const point of saved.slice(1, -1)) {
    while (cursor < source.length - 1 && !same(source[cursor], point)) cursor += 1;
    if (cursor >= source.length - 1) return null;
    result.push(cursor++);
  }
  result.push(source.length - 1);
  return result;
}

function distanceToChord(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - from.x - fraction * dx, point.y - from.y - fraction * dy);
}

function checkCorners(
  local: readonly Vec2[],
  physical: readonly Vec2[],
  kept: ReadonlySet<number>,
  probe: Probe,
  label: string,
): void {
  const coincident = (a: number, b: number): boolean =>
    Math.hypot(
      (local[a] as Vec2).x - (local[b] as Vec2).x,
      (local[a] as Vec2).y - (local[b] as Vec2).y,
    ) <= 1e-6;
  for (let index = 1; index < local.length - 1; index += 1) {
    if (coincident(index - 1, index)) continue;
    let next = index + 1;
    while (next < local.length && coincident(next, index)) next += 1;
    if (next === local.length) continue;
    const a = physical[index - 1] as Vec2;
    const b = physical[index] as Vec2;
    const c = physical[next] as Vec2;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    if (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) < Math.PI / 3) continue;
    if (kept.has(index)) probe.retainedHardCorners += 1;
    else issue(probe, `${label} lost hard corner ${String(index)}`);
  }
}
