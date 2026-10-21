import type { Vec2 } from '../../../../core/scene';

// Straightening fixes points that are a little off a straight edge. Moving a
// point further than this share of the edge's length would reshape the board
// (for example collapsing a corner), so it is refused instead.
const MAX_STRAIGHTEN_SHARE = 0.15;

export type StraightenResult =
  | { readonly ok: true; readonly points: ReadonlyArray<Vec2> }
  | { readonly ok: false; readonly reason: string };

/**
 * Moves the points between `from` and `to` onto the straight line joining them.
 * Of the two ways round the outline, the one whose points are closer to that
 * line is straightened, so the order the ends are picked in does not matter.
 */
export function straightenOutlineRun(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
): StraightenResult {
  const start = points[from];
  const end = points[to];
  if (start === undefined || end === undefined || from === to) {
    return { ok: false, reason: 'Pick two different points.' };
  }
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const runs = [runBetween(points.length, from, to), runBetween(points.length, to, from)];
  // Neighbouring points already form a straight edge; the other way round is the whole board.
  if (runs.some((run) => run.length === 0) || !(length > 0)) {
    return {
      ok: false,
      reason: 'Pick the two ends of an edge with at least one point between them.',
    };
  }
  const best = runs
    .map((run) => ({ run, offset: largestOffset(points, run, start, end) }))
    .sort((a, b) => a.offset - b.offset)[0];
  if (best === undefined || best.offset > MAX_STRAIGHTEN_SHARE * length) {
    return {
      ok: false,
      reason:
        'Those points are too far off a straight line. Pick the two ends of one edge, or drag the points instead.',
    };
  }
  const moved = new Set(best.run);
  return {
    ok: true,
    points: points.map((point, index) =>
      moved.has(index) ? projectOnto(point, start, end) : point,
    ),
  };
}

// Indices strictly between `from` and `to`, walking forward round the outline.
function runBetween(count: number, from: number, to: number): number[] {
  const run: number[] = [];
  for (let index = (from + 1) % count; index !== to; index = (index + 1) % count) run.push(index);
  return run;
}

function largestOffset(
  points: ReadonlyArray<Vec2>,
  run: ReadonlyArray<number>,
  start: Vec2,
  end: Vec2,
): number {
  return Math.max(
    ...run.map((index) => {
      const point = points[index] as Vec2;
      const projected = projectOnto(point, start, end);
      return Math.hypot(point.x - projected.x, point.y - projected.y);
    }),
  );
}

function projectOnto(point: Vec2, start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  return { x: start.x + t * dx, y: start.y + t * dy };
}
