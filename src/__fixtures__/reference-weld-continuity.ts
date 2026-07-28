import type { Vec2 } from '../core/scene';

const MAX_CONTINUATION_ANGLE_DEG = 35;
const DEGREES_PER_HALF_TURN = 180;
const MIN_CONTINUATION_DOT = Math.cos(
  (MAX_CONTINUATION_ANGLE_DEG * Math.PI) / DEGREES_PER_HALF_TURN,
);
const VECTOR_EPSILON = 1e-9;
const POLYLINE_ENDS: ReadonlyArray<ReferenceWeldPolylineEnd> = ['start', 'end'];

/** Selected endpoint in the frozen pre-index weld oracle. */
export type ReferenceWeldPolylineEnd = 'start' | 'end';

/** Endpoint match returned by the frozen pre-index weld oracle. */
export type ReferenceWeldEndpointMatch = {
  readonly aEnd: ReferenceWeldPolylineEnd;
  readonly bEnd: ReferenceWeldPolylineEnd;
  readonly dist: number;
};

type ReferenceEndpointMatchInput = {
  readonly aPoints: ReadonlyArray<Vec2>;
  readonly bPoints: ReadonlyArray<Vec2>;
  readonly aEnd: ReferenceWeldPolylineEnd;
  readonly bEnd: ReferenceWeldPolylineEnd;
  readonly maxGapPx: number;
  readonly tangentSamplePx: number;
};

type ReferenceTangentProbeInput = {
  readonly points: ReadonlyArray<Vec2>;
  readonly anchor: Vec2;
  readonly anchorIndex: number;
  readonly step: number;
  readonly tangentSamplePx: number;
};

/** Run the legacy endpoint loop without importing the production matcher. */
export function referenceBestWeldEndpointMatch(
  aPoints: ReadonlyArray<Vec2>,
  bPoints: ReadonlyArray<Vec2>,
  maxGapPx: number,
  tangentSamplePx: number,
): ReferenceWeldEndpointMatch | null {
  let best: ReferenceWeldEndpointMatch | null = null;
  for (const aEnd of POLYLINE_ENDS) {
    for (const bEnd of POLYLINE_ENDS) {
      const match = referenceEndpointMatch({
        aPoints,
        bPoints,
        aEnd,
        bEnd,
        maxGapPx,
        tangentSamplePx,
      });
      if (match !== null && (best === null || match.dist < best.dist)) best = match;
    }
  }
  return best;
}

function referenceEndpointMatch(
  input: ReferenceEndpointMatchInput,
): ReferenceWeldEndpointMatch | null {
  const aAnchor = endpoint(input.aPoints, input.aEnd);
  const bAnchor = endpoint(input.bPoints, input.bEnd);
  if (aAnchor === undefined || bAnchor === undefined) return null;
  const dist = Math.hypot(aAnchor.x - bAnchor.x, aAnchor.y - bAnchor.y);
  if (dist > input.maxGapPx) return null;
  return referenceIsContinuous(input) ? { aEnd: input.aEnd, bEnd: input.bEnd, dist } : null;
}

function referenceIsContinuous(input: ReferenceEndpointMatchInput): boolean {
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
  if (gap <= VECTOR_EPSILON) return dot(aTangent, bTangent) <= -MIN_CONTINUATION_DOT;
  const bridge = { x: dx / gap, y: dy / gap };
  const aForward = -dot(aTangent, bridge);
  const bForward = dot(bTangent, bridge);
  return aForward >= MIN_CONTINUATION_DOT && bForward >= MIN_CONTINUATION_DOT;
}

function endpoint(points: ReadonlyArray<Vec2>, end: ReferenceWeldPolylineEnd): Vec2 | undefined {
  return end === 'start' ? points[0] : points.at(-1);
}

function tangentIntoChain(
  points: ReadonlyArray<Vec2>,
  end: ReferenceWeldPolylineEnd,
  tangentSamplePx: number,
): Vec2 | null {
  if (!Number.isFinite(tangentSamplePx) || tangentSamplePx <= 0) return null;
  const anchorIndex = end === 'start' ? 0 : points.length - 1;
  const step = end === 'start' ? 1 : -1;
  const anchor = points[anchorIndex];
  if (anchor === undefined) return null;
  const probe = referenceTangentProbe({
    points,
    anchor,
    anchorIndex,
    step,
    tangentSamplePx,
  });
  if (probe === undefined) return null;
  const dx = probe.x - anchor.x;
  const dy = probe.y - anchor.y;
  const length = Math.hypot(dx, dy);
  return length <= VECTOR_EPSILON ? null : { x: dx / length, y: dy / length };
}

function referenceTangentProbe(input: ReferenceTangentProbeInput): Vec2 | undefined {
  let arcPx = 0;
  let previous = input.anchor;
  let probe: Vec2 | undefined;
  for (
    let index = input.anchorIndex + input.step;
    index >= 0 && index < input.points.length;
    index += input.step
  ) {
    const point = input.points[index];
    if (point === undefined) continue;
    const segmentPx = Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
    if (segmentPx <= VECTOR_EPSILON) continue;
    arcPx += segmentPx;
    probe = point;
    if (arcPx >= input.tangentSamplePx) break;
  }
  return probe;
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
