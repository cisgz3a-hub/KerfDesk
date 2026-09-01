import { curveNodeCount, curveNodePoint } from './curve-edit';
import { assertNever, type CurveSubpath, type PathSegment, type Vec2 } from './scene-object';

const EPSILON = 1e-9;

type CurveEndpointJoinResult =
  | { readonly kind: 'ok'; readonly curve: CurveSubpath }
  | {
      readonly kind: 'error';
      readonly reason: 'closed-path' | 'interior-anchor' | 'invalid-anchor';
    };

function joinCurveEndpoints(
  first: CurveSubpath,
  firstNodeIndex: number,
  second: CurveSubpath,
  secondNodeIndex: number,
): CurveEndpointJoinResult {
  const validation = validateOpenEndpoints(first, firstNodeIndex, second, secondNodeIndex);
  if (validation !== null) return validation;
  const orientedFirst = firstNodeIndex === 0 ? reverseCurve(first) : first;
  const orientedSecond = secondNodeIndex === 0 ? second : reverseCurve(second);
  const firstEnd = orientedFirst.segments.at(-1)?.to ?? orientedFirst.start;
  const bridge = samePoint(firstEnd, orientedSecond.start)
    ? []
    : [{ kind: 'line' as const, to: orientedSecond.start }];
  return {
    kind: 'ok',
    curve: {
      start: orientedFirst.start,
      segments: [...orientedFirst.segments, ...bridge, ...orientedSecond.segments],
      closed: false,
    },
  };
}

function closeCurveEndpoints(
  path: CurveSubpath,
  firstNodeIndex: number,
  secondNodeIndex: number,
): CurveEndpointJoinResult {
  const validation = validateOpenEndpoints(path, firstNodeIndex, path, secondNodeIndex);
  if (validation !== null) return validation;
  if (firstNodeIndex === secondNodeIndex) return { kind: 'error', reason: 'invalid-anchor' };
  const end = path.segments.at(-1)?.to ?? path.start;
  const closing = samePoint(end, path.start) ? [] : [{ kind: 'line' as const, to: path.start }];
  return {
    kind: 'ok',
    curve: { ...path, segments: [...path.segments, ...closing], closed: true },
  };
}

function validateOpenEndpoints(
  first: CurveSubpath,
  firstNodeIndex: number,
  second: CurveSubpath,
  secondNodeIndex: number,
): Extract<CurveEndpointJoinResult, { readonly kind: 'error' }> | null {
  if (first.closed || second.closed) return { kind: 'error', reason: 'closed-path' };
  if (
    curveNodePoint(first, firstNodeIndex) === null ||
    curveNodePoint(second, secondNodeIndex) === null
  ) {
    return { kind: 'error', reason: 'invalid-anchor' };
  }
  if (!isEndpoint(first, firstNodeIndex) || !isEndpoint(second, secondNodeIndex)) {
    return { kind: 'error', reason: 'interior-anchor' };
  }
  return null;
}

function isEndpoint(path: CurveSubpath, nodeIndex: number): boolean {
  return nodeIndex === 0 || nodeIndex === curveNodeCount(path) - 1;
}

function reverseCurve(path: CurveSubpath): CurveSubpath {
  const anchors = [path.start, ...path.segments.map((segment) => segment.to)];
  const segments = [...path.segments].reverse().map((segment, reverseIndex) => {
    const originalIndex = path.segments.length - reverseIndex - 1;
    return reverseSegment(segment, anchors[originalIndex] ?? path.start);
  });
  return { ...path, start: anchors.at(-1) ?? path.start, segments };
}

function reverseSegment(segment: PathSegment, to: Vec2): PathSegment {
  switch (segment.kind) {
    case 'line':
      return { kind: 'line', to };
    case 'cubic':
      return { kind: 'cubic', control1: segment.control2, control2: segment.control1, to };
    case 'elliptical-arc':
      return { ...segment, sweep: !segment.sweep, to };
    default:
      return assertNever(segment, 'PathSegment');
  }
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

/**
 * Joins distinct open endpoints or closes one open curve while preserving exact segment geometry.
 * Invalid, interior, or closed selections return a typed error and no replacement curve.
 */
export const curveEndpointJoin = {
  close: closeCurveEndpoints,
  join: joinCurveEndpoints,
} as const;
