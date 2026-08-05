import { pointToSegmentDistance, type BoundarySegment } from './vcarve-detail-geometry';

const LEAF_SIZE = 8;

type BoundaryEntry = {
  readonly segment: BoundarySegment;
  readonly sourceOrder: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type BoundaryNode = {
  readonly entries: ReadonlyArray<BoundaryEntry> | null;
  readonly left: BoundaryNode | null;
  readonly right: BoundaryNode | null;
  readonly minSourceOrder: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type VCarveBoundaryIndex = {
  readonly root: BoundaryNode | null;
  readonly segments: ReadonlyArray<BoundarySegment>;
};

export type VCarveBoundaryQueryBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Build a stable exact-query tree over one normalized region's boundary. */
export function buildVCarveBoundaryIndex(
  segments: ReadonlyArray<BoundarySegment>,
): VCarveBoundaryIndex {
  const entries = segments.map((segment, sourceOrder) => ({
    segment,
    sourceOrder,
    minX: Math.min(segment.ax, segment.bx),
    minY: Math.min(segment.ay, segment.by),
    maxX: Math.max(segment.ax, segment.bx),
    maxY: Math.max(segment.ay, segment.by),
  }));
  return {
    segments,
    root: entries.every(finiteEntry) && entries.length > 0 ? buildBoundaryNode(entries) : null,
  };
}

/** Exact nearest-segment distance with brute-force arithmetic at each visited leaf. */
export function minimumIndexedVCarveBoundaryDistance(
  index: VCarveBoundaryIndex,
  x: number,
  y: number,
): number {
  if (index.root === null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return minimumBruteForceDistance(index.segments, x, y);
  }
  let bestDistance = Number.POSITIVE_INFINITY;
  const pending: BoundaryNode[] = [index.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || pointBoxLowerBound(node, x, y) > bestDistance) continue;
    if (node.entries !== null) {
      for (const entry of node.entries) {
        bestDistance = Math.min(bestDistance, pointToSegmentDistance(x, y, entry.segment));
      }
      continue;
    }
    pushNearNodeFirst(pending, node.left, node.right, x, y);
  }
  return bestDistance;
}

/**
 * Visit exactly the segments whose AABBs can touch `box` and stop on the
 * first false predicate. Segments outside the box are mathematically unable
 * to affect callers that already use that box as their reach envelope.
 */
export function everyIndexedVCarveBoundarySegmentInBox(
  index: VCarveBoundaryIndex,
  box: VCarveBoundaryQueryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  if (index.root === null || !finiteBox(box)) {
    return index.segments.every(predicate);
  }
  const pending: BoundaryNode[] = [index.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || boxesMiss(node, box)) continue;
    if (node.entries !== null) {
      for (const entry of node.entries) {
        if (!boxesMiss(entry, box) && !predicate(entry.segment)) return false;
      }
      continue;
    }
    if (node.right !== null) pending.push(node.right);
    if (node.left !== null) pending.push(node.left);
  }
  return true;
}

export function someIndexedVCarveBoundarySegmentInBox(
  index: VCarveBoundaryIndex,
  box: VCarveBoundaryQueryBox,
  predicate: (segment: BoundarySegment) => boolean,
): boolean {
  return !everyIndexedVCarveBoundarySegmentInBox(index, box, (segment) => !predicate(segment));
}

function buildBoundaryNode(entries: ReadonlyArray<BoundaryEntry>): BoundaryNode {
  const bounds = entryBounds(entries);
  if (entries.length <= LEAF_SIZE) {
    return {
      entries: [...entries].sort((a, b) => a.sourceOrder - b.sourceOrder),
      left: null,
      right: null,
      ...bounds,
    };
  }
  const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'x' : 'y';
  const ordered = [...entries].sort((a, b) => compareEntries(a, b, axis));
  const middle = Math.floor(ordered.length / 2);
  const left = buildBoundaryNode(ordered.slice(0, middle));
  const right = buildBoundaryNode(ordered.slice(middle));
  return { entries: null, left, right, ...bounds };
}

function entryBounds(entries: ReadonlyArray<BoundaryEntry>) {
  let [minX, minY, maxX, maxY, minSourceOrder] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    Infinity,
  ];
  for (const entry of entries) {
    minX = Math.min(minX, entry.minX);
    minY = Math.min(minY, entry.minY);
    maxX = Math.max(maxX, entry.maxX);
    maxY = Math.max(maxY, entry.maxY);
    minSourceOrder = Math.min(minSourceOrder, entry.sourceOrder);
  }
  return { minX, minY, maxX, maxY, minSourceOrder };
}

function compareEntries(a: BoundaryEntry, b: BoundaryEntry, axis: 'x' | 'y'): number {
  const centerA = axis === 'x' ? a.minX + a.maxX : a.minY + a.maxY;
  const centerB = axis === 'x' ? b.minX + b.maxX : b.minY + b.maxY;
  return centerA - centerB || a.sourceOrder - b.sourceOrder;
}

function pushNearNodeFirst(
  pending: BoundaryNode[],
  left: BoundaryNode | null,
  right: BoundaryNode | null,
  x: number,
  y: number,
): void {
  if (left === null || right === null) {
    if (right !== null) pending.push(right);
    if (left !== null) pending.push(left);
    return;
  }
  const leftDistance = pointBoxLowerBound(left, x, y);
  const rightDistance = pointBoxLowerBound(right, x, y);
  const leftFirst =
    leftDistance < rightDistance ||
    (leftDistance === rightDistance && left.minSourceOrder <= right.minSourceOrder);
  pending.push(leftFirst ? right : left, leftFirst ? left : right);
}

function pointBoxLowerBound(box: VCarveBoundaryQueryBox, x: number, y: number): number {
  const dx = x < box.minX ? box.minX - x : x > box.maxX ? x - box.maxX : 0;
  const dy = y < box.minY ? box.minY - y : y > box.maxY ? y - box.maxY : 0;
  const raw = Math.hypot(dx, dy);
  const scale = Math.max(
    1,
    Math.abs(x),
    Math.abs(y),
    Math.abs(box.minX),
    Math.abs(box.minY),
    Math.abs(box.maxX),
    Math.abs(box.maxY),
  );
  return Math.max(0, raw - Number.EPSILON * scale * 16);
}

function minimumBruteForceDistance(
  segments: ReadonlyArray<BoundarySegment>,
  x: number,
  y: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, pointToSegmentDistance(x, y, segment));
  }
  return minimum;
}

function boxesMiss(a: VCarveBoundaryQueryBox, b: VCarveBoundaryQueryBox): boolean {
  return a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY;
}

function finiteEntry(entry: BoundaryEntry): boolean {
  return finiteBox(entry);
}

function finiteBox(box: VCarveBoundaryQueryBox): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY)
  );
}
