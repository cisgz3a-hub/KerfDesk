import type {
  LaserSecondPassBounds,
  LaserSecondPassPoint,
  LaserSecondPassSelection,
  LaserSecondPassStroke,
} from './types';

export type BrushCapsule = {
  readonly from: LaserSecondPassPoint;
  readonly to: LaserSecondPassPoint;
  readonly radius: number;
  readonly stroke: number;
  readonly bounds: LaserSecondPassBounds;
};
type BrushNode = {
  readonly bounds: LaserSecondPassBounds;
  readonly start: number;
  readonly end: number;
  readonly children: readonly BrushNode[];
};
export type BrushIndex = {
  readonly capsules: ReadonlyArray<BrushCapsule>;
  readonly root: BrushNode | null;
};

function finitePoint(point: LaserSecondPassPoint): boolean {
  return point != null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validateStroke(stroke: LaserSecondPassStroke): void {
  if (stroke.mode !== 'paint' && stroke.mode !== 'erase') throw new Error('Unknown brush mode.');
  if (!Number.isFinite(stroke.radiusMm) || stroke.radiusMm <= 0) {
    throw new Error('Every brush radius must be finite and greater than zero.');
  }
  if (!Number.isFinite(stroke.powerScale) || stroke.powerScale < 0) {
    throw new Error('Every painted power multiplier must be finite and nonnegative.');
  }
  if (
    !Array.isArray(stroke.points) ||
    stroke.points.length === 0 ||
    !stroke.points.every(finitePoint)
  ) {
    throw new Error('Every brush stroke needs finite X and Y points.');
  }
}

export function validateSelection(selection: LaserSecondPassSelection): void {
  if (selection.version !== 1 || !Array.isArray(selection.strokes)) {
    throw new Error('This painted selection has an unsupported format.');
  }
  if (!Number.isFinite(selection.maxPowerS) || selection.maxPowerS <= 0) {
    throw new Error('The laser maximum S power must be finite and greater than zero.');
  }
  selection.strokes.forEach(validateStroke);
}

function capsule(
  from: LaserSecondPassPoint,
  to: LaserSecondPassPoint,
  radius: number,
  stroke: number,
): BrushCapsule {
  const bounds = {
    minX: Math.min(from.x, to.x) - radius,
    minY: Math.min(from.y, to.y) - radius,
    maxX: Math.max(from.x, to.x) + radius,
    maxY: Math.max(from.y, to.y) + radius,
  };
  if (!Object.values(bounds).every(Number.isFinite)) {
    throw new Error('Brush geometry exceeds the supported numeric range.');
  }
  return { from, to, radius, stroke, bounds };
}

function rangeBounds(
  items: ReadonlyArray<BrushCapsule>,
  start: number,
  end: number,
): LaserSecondPassBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = start; index < end; index += 1) {
    const bounds = items[index]?.bounds;
    if (bounds === undefined) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function makeNode(items: BrushCapsule[], start: number, end: number): BrushNode {
  const bounds = rangeBounds(items, start, end);
  if (end - start <= 8) return { bounds, start, end, children: [] };
  const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'minX' : 'minY';
  const sorted = items.slice(start, end).sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    if (item !== undefined) items[start + index] = item;
  }
  const middle = start + Math.floor((end - start) / 2);
  return {
    bounds,
    start,
    end,
    children: [makeNode(items, start, middle), makeNode(items, middle, end)],
  };
}

export function buildBrushIndex(selection: LaserSecondPassSelection): BrushIndex {
  const capsules: BrushCapsule[] = [];
  for (let stroke = 0; stroke < selection.strokes.length; stroke += 1) {
    const item = selection.strokes[stroke];
    if (item === undefined) continue;
    for (let point = 0; point < Math.max(1, item.points.length - 1); point += 1) {
      const from = item.points[point];
      const to = item.points[point + 1] ?? from;
      if (from !== undefined && to !== undefined) {
        capsules.push(capsule(from, to, item.radiusMm, stroke));
      }
    }
  }
  return { capsules, root: capsules.length === 0 ? null : makeNode(capsules, 0, capsules.length) };
}

function overlaps(a: LaserSecondPassBounds, b: LaserSecondPassBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function visitBrushCandidates(
  index: BrushIndex,
  bounds: LaserSecondPassBounds,
  visit: (capsule: BrushCapsule) => void,
): void {
  const pending: BrushNode[] = index.root === null ? [] : [index.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || !overlaps(bounds, node.bounds)) continue;
    if (node.children.length > 0) {
      pending.push(...node.children);
      continue;
    }
    for (let item = node.start; item < node.end; item += 1) {
      const candidate = index.capsules[item];
      if (candidate !== undefined && overlaps(bounds, candidate.bounds)) visit(candidate);
    }
  }
}
