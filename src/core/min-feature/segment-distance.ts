// Exact closest points between two line segments, and point-to-segment
// distance, for the minimum-feature check (ADR-408). Plain vector algebra:
// minimise |A + s·u − (C + t·v)|² over s, t ∈ [0, 1] by solving the 2×2
// normal equations, then clamping each parameter to its segment and re-solving
// the other, which is exact because the objective is convex in each variable.

export type SegmentClosest = {
  /** Squared distance between the closest points. */
  readonly distSq: number;
  /** Parameter of the closest point on the first segment, 0..1. */
  readonly s: number;
  /** Parameter of the closest point on the second segment, 0..1. */
  readonly t: number;
};

const DEGENERATE_LENGTH_SQ = 1e-24;
/** sin² of the angle below which two segments count as parallel. */
const PARALLEL_EPSILON = 1e-12;

// Parallel segments have a whole interval of closest-point pairs. Take the
// middle of the overlap of the second segment's projection onto the first, so
// the chord between them runs through the middle of the strip they bound —
// the centre of its inscribed disk — instead of hugging one end.
function parallelMidpoint(uu: number, uv: number, ur: number): number {
  const sC = -ur / uu;
  const sD = sC + uv / uu;
  const low = Math.max(0, Math.min(sC, sD));
  const high = Math.min(1, Math.max(sC, sD));
  return low <= high ? (low + high) / 2 : 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  return value > 1 ? 1 : value;
}

/** Closest points between segments A→B and C→D. */
export function closestSegmentPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): SegmentClosest {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = dx - cx;
  const vy = dy - cy;
  const rx = ax - cx;
  const ry = ay - cy;
  const uu = ux * ux + uy * uy;
  const vv = vx * vx + vy * vy;
  const vr = vx * rx + vy * ry;
  let s = 0;
  let t = 0;
  if (uu <= DEGENERATE_LENGTH_SQ) {
    t = vv <= DEGENERATE_LENGTH_SQ ? 0 : clamp01(vr / vv);
  } else {
    const ur = ux * rx + uy * ry;
    if (vv <= DEGENERATE_LENGTH_SQ) {
      s = clamp01(-ur / uu);
    } else {
      const uv = ux * vx + uy * vy;
      const denom = uu * vv - uv * uv;
      s =
        denom > PARALLEL_EPSILON * uu * vv
          ? clamp01((uv * vr - ur * vv) / denom)
          : parallelMidpoint(uu, uv, ur);
      t = (uv * s + vr) / vv;
      if (t < 0) {
        t = 0;
        s = clamp01(-ur / uu);
      } else if (t > 1) {
        t = 1;
        s = clamp01((uv - ur) / uu);
      }
    }
  }
  const px = ax + ux * s - (cx + vx * t);
  const py = ay + uy * s - (cy + vy * t);
  return { distSq: px * px + py * py, s, t };
}

/** Squared distance from point P to segment A→B. */
export function pointSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uu = ux * ux + uy * uy;
  const t = uu <= DEGENERATE_LENGTH_SQ ? 0 : clamp01(((px - ax) * ux + (py - ay) * uy) / uu);
  const qx = ax + ux * t - px;
  const qy = ay + uy * t - py;
  return qx * qx + qy * qy;
}
