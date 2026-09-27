// The smallest rotated rectangle around a set of points (ADR-442): convex
// hull by monotone chain, then one candidate rectangle per hull edge, since
// the minimum-area rectangle always has a side on the hull. Used to read a
// detected blank's centre, size and angle. Pure core.

export type Point = { readonly x: number; readonly y: number };

export type RotatedRect = {
  readonly centre: Point;
  /** Direction of the long side, degrees in [0, 180), y down. */
  readonly axisDeg: number;
  /** Long side. */
  readonly length: number;
  /** Short side. */
  readonly width: number;
};

/** Counter-clockwise hull (in y-up terms) without collinear points; fewer than 3 points pass through. */
export function convexHull(points: ReadonlyArray<Point>): ReadonlyArray<Point> {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower = halfHull(sorted);
  const upper = halfHull([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function halfHull(sorted: ReadonlyArray<Point>): Point[] {
  const hull: Point[] = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }
  return hull;
}

function cross(o: Point | undefined, a: Point | undefined, b: Point): number {
  if (o === undefined || a === undefined) return 1;
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** The minimum-area rectangle around `points`, or null for fewer than 3 distinct points. */
export function minAreaRect(points: ReadonlyArray<Point>): RotatedRect | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best: { area: number; rect: RotatedRect } | null = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (a === undefined || b === undefined) continue;
    const rect = rectAlong(hull, Math.atan2(b.y - a.y, b.x - a.x));
    const area = rect.length * rect.width;
    if (best === null || area < best.area) best = { area, rect };
  }
  return best?.rect ?? null;
}

// The hull's bounding box in a frame turned by `angle`, mapped back.
function rectAlong(hull: ReadonlyArray<Point>, angle: number): RotatedRect {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of hull) {
    const u = p.x * cos + p.y * sin;
    const v = -p.x * sin + p.y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const centre = { x: cu * cos - cv * sin, y: cu * sin + cv * cos };
  const along = maxU - minU;
  const across = maxV - minV;
  const angleDeg = (angle * 180) / Math.PI;
  return along >= across
    ? { centre, axisDeg: halfTurn(angleDeg), length: along, width: across }
    : { centre, axisDeg: halfTurn(angleDeg + 90), length: across, width: along };
}

/** `deg` folded into [0, 180). */
export function halfTurn(deg: number): number {
  const folded = ((deg % 180) + 180) % 180;
  return folded === 180 ? 0 : folded;
}

// Points this close to a side count as lying on it, mm.
const SIDE_BAND = 1.5;
// Only the middle of each side is used, clear of rounded or chipped corners.
const SIDE_MIDDLE = 0.8;
// A side is straight when this share of the points behind its middle lies on it.
const STRAIGHT_SHARE = 0.6;

/**
 * `rect` with each straight side moved onto the median of the edge points
 * along it. The smallest rectangle touches the outermost points, so noise
 * along an edge makes it a little too big; the median does not. A side that
 * only touches a corner or a curve, as on a disc, stays where it is.
 */
export function snugRect(rect: RotatedRect, points: ReadonlyArray<Point>): RotatedRect {
  const rad = (rect.axisDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = points.map((p) => {
    const dx = p.x - rect.centre.x;
    const dy = p.y - rect.centre.y;
    return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos };
  });
  const half = (along: 'u' | 'v', sign: 1 | -1): number => {
    const reach = along === 'u' ? rect.length / 2 : rect.width / 2;
    const span = along === 'u' ? rect.width / 2 : rect.length / 2;
    const behind: number[] = [];
    for (const p of local) {
      const depth = sign * (along === 'u' ? p.u : p.v);
      const across = along === 'u' ? p.v : p.u;
      if (depth > reach / 2 && Math.abs(across) <= SIDE_MIDDLE * span) behind.push(depth);
    }
    const onSide = behind.filter((depth) => reach - depth <= SIDE_BAND);
    if (onSide.length === 0 || onSide.length < STRAIGHT_SHARE * behind.length) return reach;
    return median(onSide);
  };
  const uPlus = half('u', 1);
  const uMinus = half('u', -1);
  const vPlus = half('v', 1);
  const vMinus = half('v', -1);
  const du = (uPlus - uMinus) / 2;
  const dv = (vPlus - vMinus) / 2;
  const length = uPlus + uMinus;
  const width = vPlus + vMinus;
  const centre = { x: rect.centre.x + du * cos - dv * sin, y: rect.centre.y + du * sin + dv * cos };
  return length >= width
    ? { centre, axisDeg: rect.axisDeg, length, width }
    : { centre, axisDeg: halfTurn(rect.axisDeg + 90), length: width, width: length };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
