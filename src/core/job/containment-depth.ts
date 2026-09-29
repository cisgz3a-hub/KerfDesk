// How many closed segments enclose each segment - the ordering key behind
// "inside first" cutting, so an interior cut-out is released before the outline
// that holds it.
//
// WHY INDEXED: the previous version compared every segment against every other
// and ran a point-in-polygon test on each surviving pair. That is O(n^2) with an
// O(vertices) probe inside it, and it runs whenever insideFirst is on - the
// default. It, not the nearest-neighbour scan, is the dominant cost above a few
// thousand segments.
//
// Containers are registered into the grid cells their bounds overlap; a target
// only tests the containers sharing its cell. The grid is a CANDIDATE FILTER
// ONLY: every candidate is still checked with the identical bounds-containment
// and point-in-polygon predicates, in the same order, so the depths are the
// same numbers the exhaustive comparison produced.
//
// The pruning is provably safe: a candidate must have bounds that enclose the
// whole target's bounds, and the cell is looked up with the centre of those
// bounds, so any container that can pass necessarily covers that centre and is
// therefore registered in its cell.
//
// WHY A POINT OF THE TARGET: the inside test used to probe the centre of the
// target's bounds. Inside a concave container (a U-shaped plate, a crescent, a
// letter C's backing) that centre can sit in the container's notch while the
// whole target is inside the material, so a hole was cut as an outline: its
// kerf grew it and the part holding it was cut first. A vertex of the target
// that is not on the container's outline is on the same side as the whole
// target whenever the two outlines do not cross.

import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { boundsCenter, boundsContains, polylineBounds, type SegmentBounds } from './segment-bounds';

export type ContainmentSegment = {
  readonly polyline: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

// A container spanning more cells than this is held in a single always-checked
// list instead, so one page-sized outline cannot inflate the grid.
const MAX_CELLS_PER_CONTAINER = 64;
const MAX_GRID_SIDE = 128;

export type ContainmentOptions = {
  /** Skip a container whose bounds equal the target's, so two coincident
   * copies of one shape do not each count the other as enclosing it. */
  readonly strict?: boolean;
};

export function containmentDepths(
  segments: ReadonlyArray<ContainmentSegment>,
  options: ContainmentOptions = {},
): number[] {
  const bounds = segments.map((segment) => polylineBounds(segment.polyline));
  const containers = collectContainers(segments, bounds);
  if (containers.length === 0) return segments.map(() => 0);
  const grid = buildContainerGrid(containers, bounds);

  return segments.map((target, index) => {
    const targetBounds = bounds[index] ?? null;
    const center = boundsCenter(targetBounds);
    if (center === null || targetBounds === null) return 0;
    const candidates = grid === null ? containers : candidatesFor(grid, center);
    let depth = 0;
    for (const containerIndex of candidates) {
      if (containerIndex === index) continue;
      const container = segments[containerIndex];
      const containerBounds = bounds[containerIndex] ?? null;
      if (container === undefined || containerBounds === null) continue;
      if (!boundsMayEnclose(containerBounds, targetBounds, options)) continue;
      if (targetInside(target.polyline, center, container.polyline)) depth += 1;
    }
    return depth;
  });
}

// A vertex closer than this to the container's outline touches it, so it
// cannot say which side the target is on. 0.1 µm is far above the float noise
// a transform leaves on a vertex drawn on an edge, and far below any cut detail.
const ON_OUTLINE_MM = 1e-4;
// Vertices tried before giving up; spread along the target so a long stretch
// shared with the container's outline cannot hide every one of them.
const MAX_PROBE_VERTICES = 16;

// Probes with the first sampled vertex that is off the container's outline.
// When every sample touches it (two coincident copies), the centre of the
// target's bounds decides, as it always did.
function targetInside(
  target: ReadonlyArray<Vec2>,
  center: Vec2,
  container: ReadonlyArray<Vec2>,
): boolean {
  const stride = Math.max(1, Math.ceil(target.length / MAX_PROBE_VERTICES));
  for (let index = 0; index < target.length; index += stride) {
    const vertex = target[index];
    if (vertex !== undefined && !nearOutline(vertex, container)) {
      return pointInPolygon(vertex, container);
    }
  }
  return pointInPolygon(center, container);
}

function nearOutline(point: Vec2, outline: ReadonlyArray<Vec2>): boolean {
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[j];
    const b = outline[i];
    if (a !== undefined && b !== undefined && nearSegment(point, a, b)) return true;
  }
  return false;
}

function nearSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  if (
    point.x < Math.min(a.x, b.x) - ON_OUTLINE_MM ||
    point.x > Math.max(a.x, b.x) + ON_OUTLINE_MM ||
    point.y < Math.min(a.y, b.y) - ON_OUTLINE_MM ||
    point.y > Math.max(a.y, b.y) + ON_OUTLINE_MM
  ) {
    return false;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const offX = point.x - (a.x + t * dx);
  const offY = point.y - (a.y + t * dy);
  return offX * offX + offY * offY <= ON_OUTLINE_MM * ON_OUTLINE_MM;
}

function boundsMayEnclose(
  container: SegmentBounds,
  target: SegmentBounds,
  options: ContainmentOptions,
): boolean {
  if (!boundsContains(container, target)) return false;
  return options.strict !== true || !boundsContains(target, container);
}

function collectContainers(
  segments: ReadonlyArray<ContainmentSegment>,
  bounds: ReadonlyArray<SegmentBounds | null>,
): number[] {
  const containers: number[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i]?.closed === true && bounds[i] != null) containers.push(i);
  }
  return containers;
}

type ContainerGrid = {
  readonly cells: ReadonlyArray<ReadonlyArray<number>>;
  readonly wide: ReadonlyArray<number>;
  readonly minX: number;
  readonly minY: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly side: number;
};

// Null means "no usable grid" - a non-finite coordinate would corrupt every
// cell index, so the caller falls back to checking all containers, which is
// always correct.
function buildContainerGrid(
  containers: ReadonlyArray<number>,
  bounds: ReadonlyArray<SegmentBounds | null>,
): ContainerGrid | null {
  const extent = unionBounds(containers, bounds);
  if (extent === null) return null;
  const side = Math.min(MAX_GRID_SIDE, Math.max(1, Math.ceil(Math.sqrt(containers.length))));
  const cellWidth = Math.max((extent.maxX - extent.minX) / side, Number.MIN_VALUE);
  const cellHeight = Math.max((extent.maxY - extent.minY) / side, Number.MIN_VALUE);
  const cells: number[][] = Array.from({ length: side * side }, () => []);
  const wide: number[] = [];
  for (const index of containers) {
    const box = bounds[index];
    if (box == null) continue;
    const loX = cellIndex(box.minX - extent.minX, cellWidth, side);
    const hiX = cellIndex(box.maxX - extent.minX, cellWidth, side);
    const loY = cellIndex(box.minY - extent.minY, cellHeight, side);
    const hiY = cellIndex(box.maxY - extent.minY, cellHeight, side);
    if ((hiX - loX + 1) * (hiY - loY + 1) > MAX_CELLS_PER_CONTAINER) {
      wide.push(index);
      continue;
    }
    for (let y = loY; y <= hiY; y += 1) {
      for (let x = loX; x <= hiX; x += 1) cells[y * side + x]?.push(index);
    }
  }
  return { cells, wide, minX: extent.minX, minY: extent.minY, cellWidth, cellHeight, side };
}

function unionBounds(
  containers: ReadonlyArray<number>,
  bounds: ReadonlyArray<SegmentBounds | null>,
): SegmentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const index of containers) {
    const box = bounds[index];
    if (box == null) continue;
    if (!isFiniteBounds(box)) return null;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function isFiniteBounds(box: SegmentBounds): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY)
  );
}

function cellIndex(offset: number, cellSize: number, side: number): number {
  const raw = Math.floor(offset / cellSize);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(side - 1, Math.max(0, raw));
}

function candidatesFor(grid: ContainerGrid, probe: Vec2): number[] {
  if (!Number.isFinite(probe.x) || !Number.isFinite(probe.y)) return [...grid.wide];
  const x = cellIndex(probe.x - grid.minX, grid.cellWidth, grid.side);
  const y = cellIndex(probe.y - grid.minY, grid.cellHeight, grid.side);
  const cell = grid.cells[y * grid.side + x] ?? [];
  return grid.wide.length === 0 ? [...cell] : [...cell, ...grid.wide];
}
