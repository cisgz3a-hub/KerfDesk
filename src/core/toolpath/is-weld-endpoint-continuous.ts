import type { Vec2 } from '../scene';

const MAX_CONTINUATION_ANGLE_DEG = 35;
const DEGREES_PER_HALF_TURN = 180;
const MIN_CONTINUATION_DOT = Math.cos(
  (MAX_CONTINUATION_ANGLE_DEG * Math.PI) / DEGREES_PER_HALF_TURN,
);
const VECTOR_EPSILON = 1e-9;

/** Selected endpoint of an open weld chain. */
export type WeldPolylineEnd = 'start' | 'end';

type WeldEndpointContinuityInput = {
  readonly aPoints: ReadonlyArray<Vec2>;
  readonly aEnd: WeldPolylineEnd;
  readonly bPoints: ReadonlyArray<Vec2>;
  readonly bEnd: WeldPolylineEnd;
  readonly tangentSamplePx: number;
};

/** Immutable anchor and inward tangent used by exact weld continuity checks. */
export type WeldEndpointContinuityDescriptor = {
  readonly anchor: Vec2;
  readonly tangent: Vec2;
};

/** Immutable continuity descriptors for both ends of one chain version. */
export type WeldChainContinuityDescriptors = {
  readonly start: WeldEndpointContinuityDescriptor | null;
  readonly end: WeldEndpointContinuityDescriptor | null;
};

/** Descriptor build result with deterministic inner-work accounting. */
export type WeldChainContinuityDescriptorBuild = {
  readonly descriptors: WeldChainContinuityDescriptors;
  readonly tangentPointVisits: number;
};

type WeldDescriptorContinuityInput = {
  readonly a: WeldEndpointContinuityDescriptor | null;
  readonly b: WeldEndpointContinuityDescriptor | null;
};

type TangentBuild = {
  readonly tangent: Vec2 | null;
  readonly pointVisits: number;
};

/** Return whether two selected ends continue one drawn stroke across their gap. */
export function isWeldEndpointContinuous(input: WeldEndpointContinuityInput): boolean {
  const a = describeEndpoint(input.aPoints, input.aEnd, input.tangentSamplePx).descriptor;
  const b = describeEndpoint(input.bPoints, input.bEnd, input.tangentSamplePx).descriptor;
  return isWeldEndpointDescriptorContinuous({ a, b });
}

/** Precompute both exact continuity descriptors for one immutable chain version. */
export function describeWeldChainContinuity(
  points: ReadonlyArray<Vec2>,
  tangentSamplePx: number,
): WeldChainContinuityDescriptorBuild {
  const start = describeEndpoint(points, 'start', tangentSamplePx);
  const end = describeEndpoint(points, 'end', tangentSamplePx);
  return {
    descriptors: { start: start.descriptor, end: end.descriptor },
    tangentPointVisits: start.pointVisits + end.pointVisits,
  };
}

/** Apply the exact weld-continuity predicate to precomputed endpoint descriptors. */
export function isWeldEndpointDescriptorContinuous(input: WeldDescriptorContinuityInput): boolean {
  if (input.a === null || input.b === null) return false;
  const dx = input.b.anchor.x - input.a.anchor.x;
  const dy = input.b.anchor.y - input.a.anchor.y;
  const gap = Math.hypot(dx, dy);
  if (gap <= VECTOR_EPSILON) {
    return dot(input.a.tangent, input.b.tangent) <= -MIN_CONTINUATION_DOT;
  }
  const bridge = { x: dx / gap, y: dy / gap };
  const aForward = -dot(input.a.tangent, bridge);
  const bForward = dot(input.b.tangent, bridge);
  return aForward >= MIN_CONTINUATION_DOT && bForward >= MIN_CONTINUATION_DOT;
}

function describeEndpoint(
  points: ReadonlyArray<Vec2>,
  end: WeldPolylineEnd,
  tangentSamplePx: number,
): {
  readonly descriptor: WeldEndpointContinuityDescriptor | null;
  readonly pointVisits: number;
} {
  const anchor = end === 'start' ? points[0] : points.at(-1);
  const tangentBuild = tangentIntoChain(points, end, tangentSamplePx);
  if (anchor === undefined || tangentBuild.tangent === null) {
    return { descriptor: null, pointVisits: tangentBuild.pointVisits };
  }
  return {
    descriptor: {
      anchor: { x: anchor.x, y: anchor.y },
      tangent: tangentBuild.tangent,
    },
    pointVisits: tangentBuild.pointVisits,
  };
}

function tangentIntoChain(
  points: ReadonlyArray<Vec2>,
  end: WeldPolylineEnd,
  tangentSamplePx: number,
): TangentBuild {
  if (!isPositiveFinite(tangentSamplePx)) return { tangent: null, pointVisits: 0 };
  const anchorIndex = end === 'start' ? 0 : points.length - 1;
  const step = end === 'start' ? 1 : -1;
  const anchor = points[anchorIndex];
  if (anchor === undefined) return { tangent: null, pointVisits: 0 };
  let arcPx = 0;
  let pointVisits = 0;
  let previous = anchor;
  let probe: Vec2 | undefined;
  for (let index = anchorIndex + step; index >= 0 && index < points.length; index += step) {
    const point = points[index];
    if (point === undefined) continue;
    pointVisits += 1;
    const segmentPx = Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
    if (segmentPx <= VECTOR_EPSILON) continue;
    arcPx += segmentPx;
    probe = point;
    if (arcPx >= tangentSamplePx) break;
  }
  if (probe === undefined) return { tangent: null, pointVisits };
  const dx = probe.x - anchor.x;
  const dy = probe.y - anchor.y;
  const length = Math.hypot(dx, dy);
  return {
    tangent: length <= VECTOR_EPSILON ? null : { x: dx / length, y: dy / length },
    pointVisits,
  };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
