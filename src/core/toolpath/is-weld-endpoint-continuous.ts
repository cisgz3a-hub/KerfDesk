import type { Vec2 } from '../scene';

const MAX_CONTINUATION_ANGLE_DEG = 35;
const DEGREES_PER_HALF_TURN = 180;
const MIN_CONTINUATION_DOT = Math.cos(
  (MAX_CONTINUATION_ANGLE_DEG * Math.PI) / DEGREES_PER_HALF_TURN,
);
const VECTOR_EPSILON = 1e-9;

type PolylineEnd = 'start' | 'end';

type WeldEndpointContinuityInput = {
  readonly aPoints: ReadonlyArray<Vec2>;
  readonly aEnd: PolylineEnd;
  readonly bPoints: ReadonlyArray<Vec2>;
  readonly bEnd: PolylineEnd;
  readonly tangentSamplePx: number;
};

/** Return whether two selected ends continue one drawn stroke across their gap. */
export function isWeldEndpointContinuous(input: WeldEndpointContinuityInput): boolean {
  const aAnchor = endpoint(input.aPoints, input.aEnd);
  const bAnchor = endpoint(input.bPoints, input.bEnd);
  const aTangent = tangentIntoChain(input.aPoints, input.aEnd, input.tangentSamplePx);
  const bTangent = tangentIntoChain(input.bPoints, input.bEnd, input.tangentSamplePx);
  if (aAnchor === undefined || bAnchor === undefined || aTangent === null || bTangent === null) {
    return false;
  }
  const dx = bAnchor.x - aAnchor.x;
  const dy = bAnchor.y - aAnchor.y;
  const gap = Math.hypot(dx, dy);
  if (gap <= VECTOR_EPSILON) {
    return dot(aTangent, bTangent) <= -MIN_CONTINUATION_DOT;
  }
  const bridge = { x: dx / gap, y: dy / gap };
  const aForward = -dot(aTangent, bridge);
  const bForward = dot(bTangent, bridge);
  return aForward >= MIN_CONTINUATION_DOT && bForward >= MIN_CONTINUATION_DOT;
}

function endpoint(points: ReadonlyArray<Vec2>, end: PolylineEnd): Vec2 | undefined {
  return end === 'start' ? points[0] : points.at(-1);
}

function tangentIntoChain(
  points: ReadonlyArray<Vec2>,
  end: PolylineEnd,
  tangentSamplePx: number,
): Vec2 | null {
  if (!isPositiveFinite(tangentSamplePx)) return null;
  const anchorIndex = end === 'start' ? 0 : points.length - 1;
  const step = end === 'start' ? 1 : -1;
  const anchor = points[anchorIndex];
  if (anchor === undefined) return null;
  let arcPx = 0;
  let previous = anchor;
  let probe: Vec2 | undefined;
  for (let index = anchorIndex + step; index >= 0 && index < points.length; index += step) {
    const point = points[index];
    if (point === undefined) continue;
    const segmentPx = Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
    if (segmentPx <= VECTOR_EPSILON) continue;
    arcPx += segmentPx;
    probe = point;
    if (arcPx >= tangentSamplePx) break;
  }
  if (probe === undefined) return null;
  const dx = probe.x - anchor.x;
  const dy = probe.y - anchor.y;
  const length = Math.hypot(dx, dy);
  return length <= VECTOR_EPSILON ? null : { x: dx / length, y: dy / length };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
