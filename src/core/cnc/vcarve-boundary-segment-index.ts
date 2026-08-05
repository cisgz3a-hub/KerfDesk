import type { Vec2 } from '../scene';
import {
  pointToSegmentDistance,
  segmentToSegmentDistance,
  type BoundarySegment,
} from './vcarve-detail-geometry';

const SPATIAL_LEAF_SIZE = 8;
const PRUNING_EPSILON_SCALE = 64;

export type VCarveBoundaryBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type IndexedBoundarySegment = VCarveBoundaryBox & {
  readonly segment: BoundarySegment;
  readonly sourceIndex: number;
};

type BoundarySegmentNode = VCarveBoundaryBox & {
  readonly entries: ReadonlyArray<IndexedBoundarySegment> | null;
  readonly left: BoundarySegmentNode | null;
  readonly right: BoundarySegmentNode | null;
};

export type VCarveBoundarySegmentIndex = {
  readonly kind: 'vcarve-boundary-segment-index';
  readonly segments: ReadonlyArray<BoundarySegment>;
  readonly root: BoundarySegmentNode | null;
};

export type VCarveBoundarySegmentSource =
  | ReadonlyArray<BoundarySegment>
  | VCarveBoundarySegmentIndex;

/** Build one immutable exact-query index for a normalized V-carve region. */
export function buildVCarveBoundarySegmentIndex(
  segments: ReadonlyArray<BoundarySegment>,
): VCarveBoundarySegmentIndex {
  const entries = segments.map(indexedBoundarySegment);
  const root = entries.every(hasFiniteBounds) ? buildBoundaryNode(entries) : null;
  return { kind: 'vcarve-boundary-segment-index', segments, root };
}

/** Normalize a segment source into an index while preserving existing indexes. */
export function asVCarveBoundarySegmentIndex(
  source: VCarveBoundarySegmentSource,
): VCarveBoundarySegmentIndex {
  return isBoundaryIndex(source) ? source : buildVCarveBoundarySegmentIndex(source);
}

/** Exact nearest distance from one point to the complete source boundary. */
export function minimumVCarveBoundaryPointDistance(
  source: VCarveBoundarySegmentSource,
  point: Vec2,
): number {
  const index = asVCarveBoundarySegmentIndex(source);
  if (index.root === null || !finitePoint(point)) {
    return linearPointDistance(index.segments, point);
  }
  return nearestPointInNode(index.root, point, Number.POSITIVE_INFINITY);
}

/** Exact nearest distance from one chord to the complete source boundary. */
export function minimumVCarveBoundaryChordDistance(
  source: VCarveBoundarySegmentSource,
  a: Vec2,
  b: Vec2,
): number {
  const index = asVCarveBoundarySegmentIndex(source);
  if (index.root === null || !finitePoint(a) || !finitePoint(b)) {
    return linearChordDistance(index.segments, a, b);
  }
  const bounds = boxForPoints(a, b);
  return nearestChordInNode(index.root, bounds, a, b, Number.POSITIVE_INFINITY);
}

/** Visit only segments whose boxes can overlap the query; exact predicates remain authoritative. */
export function everyVCarveBoundarySegmentInBox(
  source: VCarveBoundarySegmentSource,
  box: VCarveBoundaryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  const index = asVCarveBoundarySegmentIndex(source);
  if (index.root === null || !hasFiniteBounds(box)) {
    return everySegmentByFullScan(index.segments, box, predicate);
  }
  return everySegmentInNode(index.root, box, predicate);
}

/** Return true when one box-overlapping segment satisfies the exact predicate. */
export function someVCarveBoundarySegmentInBox(
  source: VCarveBoundarySegmentSource,
  box: VCarveBoundaryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  return !everyVCarveBoundarySegmentInBox(source, box, (segment) => !predicate(segment));
}

function buildBoundaryNode(entries: ReadonlyArray<IndexedBoundarySegment>): BoundarySegmentNode {
  const bounds = combinedBounds(entries);
  if (entries.length <= SPATIAL_LEAF_SIZE) {
    return {
      ...bounds,
      entries: [...entries].sort((a, b) => a.sourceIndex - b.sourceIndex),
      left: null,
      right: null,
    };
  }
  const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'x' : 'y';
  const ordered = [...entries].sort((a, b) => compareEntries(a, b, axis));
  const middle = Math.floor(ordered.length / 2);
  return {
    ...bounds,
    entries: null,
    left: buildBoundaryNode(ordered.slice(0, middle)),
    right: buildBoundaryNode(ordered.slice(middle)),
  };
}

function nearestPointInNode(node: BoundarySegmentNode, point: Vec2, currentBest: number): number {
  if (!canBeat(pointBoxDistance(point, node), currentBest)) return currentBest;
  let best = currentBest;
  if (node.entries !== null) {
    for (const entry of node.entries) {
      best = Math.min(best, pointToSegmentDistance(point.x, point.y, entry.segment));
    }
    return best;
  }
  const children = orderedNodesForPoint(node, point);
  for (const child of children) best = nearestPointInNode(child, point, best);
  return best;
}

function nearestChordInNode(
  node: BoundarySegmentNode,
  chordBounds: VCarveBoundaryBox,
  a: Vec2,
  b: Vec2,
  currentBest: number,
): number {
  if (!canBeat(boxDistance(chordBounds, node), currentBest)) return currentBest;
  let best = currentBest;
  if (node.entries !== null) {
    for (const entry of node.entries) {
      best = Math.min(best, segmentToSegmentDistance(a, b, entry.segment));
    }
    return best;
  }
  const children = orderedNodesForBox(node, chordBounds);
  for (const child of children) best = nearestChordInNode(child, chordBounds, a, b, best);
  return best;
}

function everySegmentInNode(
  node: BoundarySegmentNode,
  box: VCarveBoundaryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  if (!boxesOverlap(node, box)) return true;
  if (node.entries !== null) {
    for (const entry of node.entries) {
      if (boxesOverlap(entry, box) && !predicate(entry.segment)) return false;
    }
    return true;
  }
  return (
    (node.left === null || everySegmentInNode(node.left, box, predicate)) &&
    (node.right === null || everySegmentInNode(node.right, box, predicate))
  );
}

function orderedNodesForPoint(
  node: BoundarySegmentNode,
  point: Vec2,
): ReadonlyArray<BoundarySegmentNode> {
  const children = [node.left, node.right].filter(
    (child): child is BoundarySegmentNode => child !== null,
  );
  return children.sort((a, b) => pointBoxDistance(point, a) - pointBoxDistance(point, b));
}

function orderedNodesForBox(
  node: BoundarySegmentNode,
  box: VCarveBoundaryBox,
): ReadonlyArray<BoundarySegmentNode> {
  const children = [node.left, node.right].filter(
    (child): child is BoundarySegmentNode => child !== null,
  );
  return children.sort((a, b) => boxDistance(box, a) - boxDistance(box, b));
}

function pointBoxDistance(point: Vec2, box: VCarveBoundaryBox): number {
  const dx = point.x < box.minX ? box.minX - point.x : point.x > box.maxX ? point.x - box.maxX : 0;
  const dy = point.y < box.minY ? box.minY - point.y : point.y > box.maxY ? point.y - box.maxY : 0;
  return Math.hypot(dx, dy);
}

function boxDistance(a: VCarveBoundaryBox, b: VCarveBoundaryBox): number {
  const dx = a.maxX < b.minX ? b.minX - a.maxX : b.maxX < a.minX ? a.minX - b.maxX : 0;
  const dy = a.maxY < b.minY ? b.minY - a.maxY : b.maxY < a.minY ? a.minY - b.maxY : 0;
  return Math.hypot(dx, dy);
}

function canBeat(lowerBound: number, best: number): boolean {
  if (lowerBound <= best) return true;
  const scale = Math.max(1, Math.abs(lowerBound), Math.abs(best));
  return lowerBound - best <= Number.EPSILON * PRUNING_EPSILON_SCALE * scale;
}

function indexedBoundarySegment(
  segment: BoundarySegment,
  sourceIndex: number,
): IndexedBoundarySegment {
  return {
    segment,
    sourceIndex,
    minX: Math.min(segment.ax, segment.bx),
    minY: Math.min(segment.ay, segment.by),
    maxX: Math.max(segment.ax, segment.bx),
    maxY: Math.max(segment.ay, segment.by),
  };
}

function combinedBounds(entries: ReadonlyArray<VCarveBoundaryBox>): VCarveBoundaryBox {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const entry of entries) {
    minX = Math.min(minX, entry.minX);
    minY = Math.min(minY, entry.minY);
    maxX = Math.max(maxX, entry.maxX);
    maxY = Math.max(maxY, entry.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function boxForPoints(a: Vec2, b: Vec2): VCarveBoundaryBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function compareEntries(
  a: IndexedBoundarySegment,
  b: IndexedBoundarySegment,
  axis: 'x' | 'y',
): number {
  const aPrimary = axis === 'x' ? a.minX + a.maxX : a.minY + a.maxY;
  const bPrimary = axis === 'x' ? b.minX + b.maxX : b.minY + b.maxY;
  const aSecondary = axis === 'x' ? a.minY + a.maxY : a.minX + a.maxX;
  const bSecondary = axis === 'x' ? b.minY + b.maxY : b.minX + b.maxX;
  return aPrimary - bPrimary || aSecondary - bSecondary || a.sourceIndex - b.sourceIndex;
}

function boxesOverlap(a: VCarveBoundaryBox, b: VCarveBoundaryBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function hasFiniteBounds(box: VCarveBoundaryBox): boolean {
  return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite);
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isBoundaryIndex(
  source: VCarveBoundarySegmentSource,
): source is VCarveBoundarySegmentIndex {
  return !Array.isArray(source);
}

function linearPointDistance(segments: ReadonlyArray<BoundarySegment>, point: Vec2): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, pointToSegmentDistance(point.x, point.y, segment));
  }
  return minimum;
}

function linearChordDistance(segments: ReadonlyArray<BoundarySegment>, a: Vec2, b: Vec2): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments)
    minimum = Math.min(minimum, segmentToSegmentDistance(a, b, segment));
  return minimum;
}

function everySegmentByFullScan(
  segments: ReadonlyArray<BoundarySegment>,
  box: VCarveBoundaryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  for (const segment of segments) {
    if (!segmentMayOverlapBox(segment, box)) continue;
    if (!predicate(segment)) return false;
  }
  return true;
}

function segmentMayOverlapBox(segment: BoundarySegment, box: VCarveBoundaryBox): boolean {
  if (Math.min(segment.ax, segment.bx) > box.maxX) return false;
  if (Math.max(segment.ax, segment.bx) < box.minX) return false;
  if (Math.min(segment.ay, segment.by) > box.maxY) return false;
  if (Math.max(segment.ay, segment.by) < box.minY) return false;
  return true;
}
