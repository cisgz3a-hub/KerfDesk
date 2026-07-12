import type { CubicPathSegment, CurveSubpath, PathSegment, Vec2 } from './scene-object';

const EPSILON = 1e-9;

export function curveNodeCount(path: CurveSubpath): number {
  const last = path.segments.at(-1)?.to;
  return path.closed && last !== undefined && samePoint(last, path.start)
    ? path.segments.length
    : path.segments.length + 1;
}

export function curveNodePoint(path: CurveSubpath, nodeIndex: number): Vec2 | null {
  if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= curveNodeCount(path))
    return null;
  return nodeIndex === 0 ? path.start : (path.segments[nodeIndex - 1]?.to ?? null);
}

export function curveControlPoint(
  path: CurveSubpath,
  nodeIndex: number,
  side: 'incoming' | 'outgoing',
): Vec2 | null {
  if (curveNodePoint(path, nodeIndex) === null) return null;
  const segmentIndex =
    side === 'incoming'
      ? incomingSegmentIndex(path, nodeIndex)
      : outgoingSegmentIndex(path, nodeIndex);
  if (segmentIndex === null) return null;
  const segment = path.segments[segmentIndex];
  if (segment?.kind !== 'cubic') return null;
  return side === 'incoming' ? segment.control2 : segment.control1;
}

export function moveCurveAnchor(
  path: CurveSubpath,
  nodeIndex: number,
  delta: Vec2,
): CurveSubpath | null {
  const anchor = curveNodePoint(path, nodeIndex);
  if (anchor === null || !finitePoint(delta)) return null;
  const segments = [...path.segments];
  const incomingIndex = incomingSegmentIndex(path, nodeIndex);
  const outgoingIndex = nodeIndex < segments.length ? nodeIndex : null;
  if (incomingIndex !== null) {
    const incoming = segments[incomingIndex] as PathSegment;
    segments[incomingIndex] = translateIncoming(incoming, delta);
  }
  if (outgoingIndex !== null && outgoingIndex !== incomingIndex) {
    const outgoing = segments[outgoingIndex] as PathSegment;
    segments[outgoingIndex] = translateOutgoing(outgoing, delta);
  }
  return {
    ...path,
    start: nodeIndex === 0 ? add(path.start, delta) : path.start,
    segments,
  };
}

export function moveCurveControl(
  path: CurveSubpath,
  nodeIndex: number,
  side: 'incoming' | 'outgoing',
  to: Vec2,
): CurveSubpath | null {
  if (curveNodePoint(path, nodeIndex) === null || !finitePoint(to)) return null;
  const segmentIndex =
    side === 'incoming'
      ? incomingSegmentIndex(path, nodeIndex)
      : outgoingSegmentIndex(path, nodeIndex);
  if (segmentIndex === null) return null;
  const segment = path.segments[segmentIndex];
  if (segment?.kind !== 'cubic') return null;
  const segments = [...path.segments];
  segments[segmentIndex] =
    side === 'incoming' ? { ...segment, control2: to } : { ...segment, control1: to };
  return { ...path, segments };
}

export function convertCurveSegment(
  path: CurveSubpath,
  segmentIndex: number,
  kind: 'line' | 'cubic',
): CurveSubpath | null {
  const segment = path.segments[segmentIndex];
  const from = segmentIndex === 0 ? path.start : path.segments[segmentIndex - 1]?.to;
  if (segment === undefined || from === undefined) return null;
  if (segment.kind === kind) return path;
  const segments = [...path.segments];
  segments[segmentIndex] =
    kind === 'line' ? { kind: 'line', to: segment.to } : lineAsCubic(from, segment.to);
  return { ...path, segments };
}

export function smoothCurveNode(path: CurveSubpath, nodeIndex: number): CurveSubpath | null {
  const anchor = curveNodePoint(path, nodeIndex);
  const incomingIndex = incomingSegmentIndex(path, nodeIndex);
  const outgoingIndex = outgoingSegmentIndex(path, nodeIndex);
  if (anchor === null || incomingIndex === null || outgoingIndex === null) return null;
  const incoming = path.segments[incomingIndex];
  const outgoing = path.segments[outgoingIndex];
  if (incoming?.kind !== 'cubic' || outgoing?.kind !== 'cubic') return null;
  const inLength = distance(anchor, incoming.control2);
  const outLength = distance(anchor, outgoing.control1);
  const direction = normalized({
    x: outgoing.control1.x - incoming.control2.x,
    y: outgoing.control1.y - incoming.control2.y,
  });
  if (direction === null) return null;
  const segments = [...path.segments];
  segments[incomingIndex] = {
    ...incoming,
    control2: { x: anchor.x - direction.x * inLength, y: anchor.y - direction.y * inLength },
  };
  segments[outgoingIndex] = {
    ...outgoing,
    control1: { x: anchor.x + direction.x * outLength, y: anchor.y + direction.y * outLength },
  };
  return { ...path, segments };
}

export function setCurveStartNode(path: CurveSubpath, nodeIndex: number): CurveSubpath | null {
  if (!path.closed || nodeIndex <= 0 || nodeIndex >= curveNodeCount(path)) return null;
  const start = curveNodePoint(path, nodeIndex);
  if (start === null) return null;
  return {
    ...path,
    start,
    segments: [...path.segments.slice(nodeIndex), ...path.segments.slice(0, nodeIndex)],
  };
}

export function breakCurveAtNode(path: CurveSubpath, nodeIndex: number): CurveSubpath | null {
  if (!path.closed) return null;
  const rotated = nodeIndex === 0 ? path : setCurveStartNode(path, nodeIndex);
  if (rotated === null || rotated.segments.length === 0) return null;
  return { ...rotated, segments: rotated.segments.slice(0, -1), closed: false };
}

export function joinCurveSubpaths(first: CurveSubpath, second: CurveSubpath): CurveSubpath | null {
  if (first.closed || second.closed) return null;
  const firstEnd = first.segments.at(-1)?.to ?? first.start;
  const bridge = samePoint(firstEnd, second.start)
    ? []
    : [{ kind: 'line' as const, to: second.start }];
  return {
    start: first.start,
    segments: [...first.segments, ...bridge, ...second.segments],
    closed: false,
  };
}

function incomingSegmentIndex(path: CurveSubpath, nodeIndex: number): number | null {
  if (nodeIndex > 0) return nodeIndex - 1;
  return path.closed && path.segments.length > 0 ? path.segments.length - 1 : null;
}

function outgoingSegmentIndex(path: CurveSubpath, nodeIndex: number): number | null {
  return nodeIndex < path.segments.length ? nodeIndex : null;
}

function translateIncoming(segment: PathSegment, delta: Vec2): PathSegment {
  if (segment.kind !== 'cubic') return { ...segment, to: add(segment.to, delta) };
  return { ...segment, control2: add(segment.control2, delta), to: add(segment.to, delta) };
}

function translateOutgoing(segment: PathSegment, delta: Vec2): PathSegment {
  return segment.kind === 'cubic'
    ? { ...segment, control1: add(segment.control1, delta) }
    : segment;
}

function lineAsCubic(from: Vec2, to: Vec2): CubicPathSegment {
  return {
    kind: 'cubic',
    control1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    control2: { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
    to,
  };
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalized(vector: Vec2): Vec2 | null {
  const length = Math.hypot(vector.x, vector.y);
  return length <= EPSILON ? null : { x: vector.x / length, y: vector.y / length };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}
