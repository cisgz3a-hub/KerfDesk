import type { Bounds } from '../scene/scene-object';
import type {
  CopyAlongPathGuidePath,
  CopyAlongPathShortfall,
  CopyAlongPathSpec,
} from './copy-along-path';
import { fitScaledGapPieces, type GapPiece } from './copy-along-path-piece-fit';
import { finiteNonNegative } from '../util/finite';

const FIT_EPS_MM = 1e-6;
const MIN_STEP_MM = 1e-3;

export type CopyDistances =
  | { readonly kind: 'ok'; readonly count: number; readonly at: (index: number) => number }
  | CopyAlongPathShortfall;

export function copyScale(spec: CopyAlongPathSpec, index: number, count: number): number {
  const end = spec.endScalePercent;
  if (end === undefined || !Number.isFinite(end) || end <= 0 || count < 2) return 1;
  const t = index / (count - 1);
  return 1 - t + (end / 100) * t;
}

/** Gap count and placement use the final sizes, including the closing seam.
 * Along a straight guide (or when copies turn), the sum is an arithmetic
 * series. Upright copies on bends use the guide's piecewise constant extent. */
export function scaledGapDistances(
  guide: CopyAlongPathGuidePath,
  source: Bounds,
  spec: CopyAlongPathSpec,
  start: number,
  maxCopies: number,
): CopyDistances {
  if (maxCopies < 1) return { kind: 'too-many' };
  const end = guide.closed
    ? start + guide.walk.lengthMm
    : guide.walk.lengthMm - finiteNonNegative(spec.endOffsetMm);
  const span = end - start;
  if (span < -FIT_EPS_MM) return { kind: 'no-room' };
  const pieces = guidePieces(guide, source, spec.rotateCopies);
  const first = pieces[0];
  if (first === undefined) return { kind: 'no-step' };
  const gap = finiteNonNegative(spec.spacingMm);
  const lastScale = copyScale(spec, 1, 2);
  if (pieces.every((piece) => piece.extent === first.extent)) {
    return constantExtentDistances(
      first.extent,
      gap,
      lastScale,
      start,
      span,
      guide.closed,
      maxCopies,
    );
  }
  const minimum = pieces.reduce((value, piece) => Math.min(value, piece.extent), Infinity);
  const averageStep = gap + minimum * (0.5 + lastScale / 2);
  const upper = countBound(span, averageStep, guide.closed);
  return varyingExtentDistances(pieces, gap, lastScale, start, end, upper, guide.closed, maxCopies);
}

function varyingExtentDistances(
  pieces: readonly GapPiece[],
  gap: number,
  lastScale: number,
  start: number,
  end: number,
  upper: number,
  closed: boolean,
  maxCopies: number,
): CopyDistances {
  let best = { count: 1, at: (_index: number) => start };
  let high = upper;
  // Upright extents jump at bends, so feasibility need not be monotone in
  // count. This deterministic feasible search can leave spare room; it does
  // not promise a global maximum. Neither its candidates nor its chosen
  // layout depend on the caller's budget. Every retained count is proven to
  // fit, and subsequent retained counts can only increase.
  while (best.count < high) {
    const count = high === upper ? high : best.count + Math.ceil((high - best.count) / 2);
    const fit = fitScaledGapPieces({ pieces, gap, lastScale, start, end, count, closed });
    if (fit === null) high = count - 1;
    else {
      if (count > maxCopies) return { kind: 'too-many' };
      best = fit;
    }
  }
  return { kind: 'ok', ...best };
}

function constantExtentDistances(
  extent: number,
  gap: number,
  lastScale: number,
  start: number,
  span: number,
  closed: boolean,
  maxCopies: number,
): CopyDistances {
  const averageStep = gap + extent * (0.5 + lastScale / 2);
  if (averageStep < MIN_STEP_MM) return { kind: 'no-step' };
  const count = countBound(span, averageStep, closed);
  if (count > maxCopies) return { kind: 'too-many' };
  return {
    kind: 'ok',
    count,
    at: (index) =>
      count < 2
        ? start
        : start + index * (gap + extent * (1 + ((lastScale - 1) * index) / (2 * (count - 1)))),
  };
}

function countBound(span: number, step: number, closed: boolean): number {
  // Keep integer indexing exact even for astronomical guide lengths. This
  // numeric bound is independent of the caller's project capacity.
  return Math.max(
    1,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.floor((span + FIT_EPS_MM) / Math.max(MIN_STEP_MM, step)) + (closed ? 0 : 1),
    ),
  );
}

function guidePieces(guide: CopyAlongPathGuidePath, source: Bounds, rotate: boolean): GapPiece[] {
  const width = Math.max(0, source.maxX - source.minX);
  const height = Math.max(0, source.maxY - source.minY);
  const pieces: GapPiece[] = [];
  for (let index = 1; index < guide.walk.points.length; index += 1) {
    const a = guide.walk.points[index - 1];
    const b = guide.walk.points[index];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const start = guide.walk.cumulative[index - 1] ?? 0;
    const end = guide.walk.cumulative[index] ?? start;
    pieces.push({
      // Keep centres out of the outgoing-tangent tolerance band before a
      // vertex. At a closed seam that band also wraps to the first edge.
      start,
      end: index === guide.walk.points.length - 1 ? end : end - FIT_EPS_MM,
      extent: rotate
        ? width
        : (width * Math.abs(b.x - a.x) + height * Math.abs(b.y - a.y)) / length,
    });
  }
  const last = pieces[pieces.length - 1];
  if (last !== undefined)
    pieces[pieces.length - 1] = {
      ...last,
      end: guide.walk.lengthMm - (guide.closed ? FIT_EPS_MM : 0),
      // wrap() changes to the first edge strictly AFTER this threshold.
      includeEnd: guide.closed,
    };
  if (!guide.closed) return pieces;
  const repeated = pieces.map((piece) => ({
    ...piece,
    start: piece.start + guide.walk.lengthMm,
    end: piece.end + guide.walk.lengthMm,
  }));
  return pieces.concat(repeated);
}
