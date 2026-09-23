import {
  formatGcodeCoordinateMm,
  GCODE_COORDINATE_DECIMAL_PLACES,
} from '../gcode/coordinate-format';
import type { Vec2 } from '../scene';
import { firstContourIntervals, type OwnedInterval } from './cut-overlap-intervals';
import type { CutGroup, CutSegment } from './job';

const SCALE = 10 ** GCODE_COORDINATE_DECIMAL_PLACES;
type Edge = OwnedInterval & {
  readonly key: string;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly from: number;
  readonly to: number;
};
type Span = readonly [Vec2, Vec2];

/** Opt-in output cleanup within ONE compiled laser operation/settings group.
 * Kerf and tabs already exist in these polylines. We only remove powered spans;
 * never join across a removed interval, extend a cut or compare separate passes.
 * Retracing within a single contour is retained as deliberate path motion. */
export function removeCutOverlaps(group: CutGroup): CutGroup {
  if (group.segments.length < 2 || group.segments.some(isCncProjection)) return group;
  const lines = new Map<string, Edge[]>();
  const contours = group.segments.map((segment, owner) => {
    const edges: Array<Edge | null> = [];
    for (let index = 1; index < segment.polyline.length; index += 1) {
      const edge = indexedEdge(
        segment.polyline[index - 1] as Vec2,
        segment.polyline[index] as Vec2,
        owner,
      );
      edges.push(edge);
      if (edge === null) continue;
      const line = lines.get(edge.key);
      if (line === undefined) lines.set(edge.key, [edge]);
      else line.push(edge);
    }
    return edges;
  });
  const ownership = new Map<string, OwnedInterval[]>();
  for (const [key, edges] of lines) ownership.set(key, firstContourIntervals(edges));
  const segments = group.segments.flatMap((segment, owner) =>
    retainContourSpans(segment, contours[owner] ?? [], ownership),
  );
  return segments.length === group.segments.length &&
    segments.every((segment, index) => segment === group.segments[index])
    ? group
    : { ...group, segments };
}

function isCncProjection(segment: CutSegment): boolean {
  return segment.plannerCoordinatesRepresented === true || segment.plannerMotion !== undefined;
}

function indexedEdge(start: Vec2, end: Vec2, owner: number): Edge | null {
  const ax = integerCoordinate(start.x);
  const ay = integerCoordinate(start.y);
  const bx = integerCoordinate(end.x);
  const by = integerCoordinate(end.y);
  if (ax === null || ay === null || bx === null || by === null) return null;
  if (!Number.isSafeInteger(bx - ax) || !Number.isSafeInteger(by - ay)) return null;
  let dx = BigInt(bx) - BigInt(ax);
  let dy = BigInt(by) - BigInt(ay);
  if (dx === 0n && dy === 0n) return null;
  [dx, dy] = forwardDirection(dx, dy);
  const divisor = gcd(dx, dy);
  dx /= divisor;
  dy /= divisor;
  // Integer arithmetic establishes exact collinearity at emitted precision. No
  // distance tolerance can accidentally consume a neighbouring parallel cut.
  const offset = dx * BigInt(ay) - dy * BigInt(ax);
  const from = dx === 0n ? ay : ax;
  const to = dx === 0n ? by : bx;
  return {
    key: `${dx},${dy},${offset}`,
    low: Math.min(from, to),
    high: Math.max(from, to),
    owner,
    start,
    end,
    from,
    to,
  };
}

function forwardDirection(dx: bigint, dy: bigint): readonly [bigint, bigint] {
  return dx < 0n || (dx === 0n && dy < 0n) ? [-dx, -dy] : [dx, dy];
}

function integerCoordinate(value: number): number | null {
  const integer = Math.round(Number(formatGcodeCoordinateMm(value)) * SCALE);
  // Unrepresentable values retain their original motion, rather than becoming
  // a new refusal or being coerced into another line's key.
  return Number.isSafeInteger(integer) ? integer : null;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function retainContourSpans(
  segment: CutSegment,
  edges: ReadonlyArray<Edge | null>,
  ownership: ReadonlyMap<string, ReadonlyArray<OwnedInterval>>,
): CutSegment[] {
  let changed = false;
  const spans: Span[] = [];
  edges.forEach((edge, index) => {
    if (edge === null) {
      spans.push([segment.polyline[index] as Vec2, segment.polyline[index + 1] as Vec2]);
      return;
    }
    const retained = ownedSpans(edge, ownership.get(edge.key) ?? []);
    if (retained.length !== 1 || retained[0]?.[0] !== edge.start || retained[0]?.[1] !== edge.end)
      changed = true;
    for (const span of retained) spans.push(span);
  });
  if (!changed) return [segment];
  const pieces: Vec2[][] = [];
  for (const [start, end] of spans) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && sameEmittedPoint(last[last.length - 1] as Vec2, start))
      last.push(end);
    else pieces.push([start, end]);
  }
  return pieces.map((polyline) => ({ ...segment, polyline, closed: false }));
}

function ownedSpans(edge: Edge, intervals: ReadonlyArray<OwnedInterval>): Span[] {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((intervals[middle] as OwnedInterval).high <= edge.low) low = middle + 1;
    else high = middle;
  }
  const retained: Array<readonly [number, number]> = [];
  for (let index = low; index < intervals.length; index += 1) {
    const interval = intervals[index] as OwnedInterval;
    if (interval.low >= edge.high) break;
    if (interval.owner === edge.owner)
      retained.push([Math.max(edge.low, interval.low), Math.min(edge.high, interval.high)]);
  }
  if (edge.from > edge.to) retained.reverse();
  return retained.map(([start, end]) =>
    edge.from < edge.to
      ? [edgePoint(edge, start), edgePoint(edge, end)]
      : [edgePoint(edge, end), edgePoint(edge, start)],
  );
}

function edgePoint(edge: Edge, at: number): Vec2 {
  if (at === edge.from) return edge.start;
  if (at === edge.to) return edge.end;
  const ratio = (at - edge.from) / (edge.to - edge.from);
  const coordinate = (start: number, end: number): number => {
    const representedStart = Number(formatGcodeCoordinateMm(start));
    const representedEnd = Number(formatGcodeCoordinateMm(end));
    return Number(
      formatGcodeCoordinateMm(representedStart + ratio * (representedEnd - representedStart)),
    );
  };
  return { x: coordinate(edge.start.x, edge.end.x), y: coordinate(edge.start.y, edge.end.y) };
}

function sameEmittedPoint(a: Vec2, b: Vec2): boolean {
  return (
    formatGcodeCoordinateMm(a.x) === formatGcodeCoordinateMm(b.x) &&
    formatGcodeCoordinateMm(a.y) === formatGcodeCoordinateMm(b.y)
  );
}
