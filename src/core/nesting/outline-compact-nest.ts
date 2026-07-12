import {
  areaD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  type PathsD,
} from 'clipper2-ts';
import {
  quickNest,
  type NestItem,
  type NestPlacement,
  type NestRect,
  type QuickNestResult,
} from './quick-nest';

export type NestOutline = ReadonlyArray<ReadonlyArray<{ readonly x: number; readonly y: number }>>;

export type OutlineNestItem = NestItem & { readonly outline?: NestOutline };
export type OutlineNestResult =
  | {
      readonly ok: true;
      readonly placements: ReadonlyArray<NestPlacement>;
      readonly usedOutline: boolean;
    }
  | Extract<QuickNestResult, { readonly ok: false }>;

export const OUTLINE_NEST_ITEM_LIMIT = 150;
const MAX_CANDIDATES_PER_ITEM = 4_000;
const AREA_EPSILON = 1e-7;

export function outlineNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  options: { readonly padding: number; readonly obstacles?: ReadonlyArray<NestRect> },
): OutlineNestResult {
  if (items.length === 0 || items.length > OUTLINE_NEST_ITEM_LIMIT) {
    const result = quickNest(bin, items, options);
    return result.ok ? { ...result, usedOutline: false } : result;
  }
  const rectangular = quickNest(bin, items, options);
  try {
    const seeds = [
      ...(rectangular.ok ? [rectangular.placements] : []),
      stagingPlacements(bin, items, options.padding, false, 'row'),
      stagingPlacements(bin, items, options.padding, true, 'row'),
      stagingPlacements(bin, items, options.padding, false, 'column'),
    ];
    let best: ReadonlyArray<NestPlacement> | null = null;
    let bestScore: readonly [number, number, number] | null = null;
    for (const seed of seeds) {
      const placements = compactOutlineNest(bin, items, seed, options);
      if (!validNest(bin, items, placements, options)) continue;
      const score = placementScore(bin, items, placements, options.padding);
      if (bestScore === null || comparePlacementScore(score, bestScore) < 0) {
        best = placements;
        bestScore = score;
      }
    }
    return best === null
      ? { ok: false, unplacedIds: items.map((item) => item.id) }
      : { ok: true, placements: best, usedOutline: true };
  } catch {
    return rectangular.ok ? { ...rectangular, usedOutline: false } : rectangular;
  }
}

/**
 * Compacts a valid rectangular nest using actual closed contours. The input
 * placements remain the conservative fallback whenever Clipper rejects a
 * contour, the corpus is too large, or no candidate improves the footprint.
 */
export function compactOutlineNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: { readonly padding: number; readonly obstacles?: ReadonlyArray<NestRect> },
): ReadonlyArray<NestPlacement> {
  if (items.length === 0 || items.length > OUTLINE_NEST_ITEM_LIMIT) return placements;
  try {
    return compactOutlineNestUnsafe(bin, items, placements, options);
  } catch {
    return placements;
  }
}

function compactOutlineNestUnsafe(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: { readonly padding: number; readonly obstacles?: ReadonlyArray<NestRect> },
): ReadonlyArray<NestPlacement> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const states = placements.flatMap((placement) => {
    const item = byId.get(placement.id);
    return item === undefined ? [] : [placedState(item, placement, options.padding)];
  });
  if (states.length !== placements.length) return placements;
  const obstacles = (options.obstacles ?? []).map((rect) => obstacleState(rect, options.padding));
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < states.length; index += 1) {
      const current = states[index];
      if (current !== undefined) {
        states[index] = bestCompactedState(bin, states, index, current, obstacles, options.padding);
      }
    }
  }
  return states.map((state) => state.placement);
}

function bestCompactedState(
  bin: NestRect,
  states: ReadonlyArray<PlacedState>,
  index: number,
  current: PlacedState,
  obstacles: ReadonlyArray<PlacedState>,
  padding: number,
): PlacedState {
  const others = states.filter((_state, otherIndex) => otherIndex !== index);
  const candidates = candidatePlacements(bin, current, [...others, ...obstacles]);
  let best = current;
  let bestScore = footprintScore(bin, states, index, current);
  let bestIsValid = inside(bin, current.bounds) && !collides(current, others, obstacles);
  for (const placement of candidates) {
    const candidate = placedState(current.item, placement, padding);
    if (!inside(bin, candidate.bounds) || collides(candidate, others, obstacles)) continue;
    const score = footprintScore(bin, states, index, candidate);
    if (!bestIsValid || compareScore(score, bestScore) < 0) {
      best = candidate;
      bestScore = score;
      bestIsValid = true;
    }
  }
  return best;
}

function stagingPlacements(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  padding: number,
  rotate: boolean,
  direction: 'row' | 'column',
): ReadonlyArray<NestPlacement> {
  const gap = finiteNonNegative(padding);
  let x = bin.minX + gap / 2;
  let y = bin.minY + gap / 2;
  return [...items].sort(compareItems).map((item) => {
    const rotated90 = rotate && item.canRotate && item.width !== item.height;
    const placement = { id: item.id, x, y, rotated90 };
    const width = rotated90 ? item.height : item.width;
    const height = rotated90 ? item.width : item.height;
    if (direction === 'row') x += width + gap;
    else y += height + gap;
    return placement;
  });
}

function validNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: { readonly padding: number; readonly obstacles?: ReadonlyArray<NestRect> },
): boolean {
  if (placements.length !== items.length) return false;
  const byId = new Map(items.map((item) => [item.id, item]));
  const states = placements.flatMap((placement) => {
    const item = byId.get(placement.id);
    return item === undefined ? [] : [placedState(item, placement, options.padding)];
  });
  if (states.length !== items.length || states.some((state) => !inside(bin, state.bounds))) {
    return false;
  }
  const obstacles = (options.obstacles ?? []).map((rect) => obstacleState(rect, options.padding));
  return states.every(
    (state, index) =>
      !collides(
        state,
        states.filter((_other, other) => other !== index),
        obstacles,
      ),
  );
}

function placementScore(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  padding: number,
): readonly [number, number, number] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const bounds = placements.flatMap((placement) => {
    const item = byId.get(placement.id);
    return item === undefined ? [] : [placedState(item, placement, padding).bounds];
  });
  const width = Math.max(...bounds.map((rect) => rect.maxX)) - bin.minX;
  const height = Math.max(...bounds.map((rect) => rect.maxY)) - bin.minY;
  return [width * height, height, width];
}

function comparePlacementScore(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function compareItems(left: OutlineNestItem, right: OutlineNestItem): number {
  return (
    right.width * right.height - left.width * left.height ||
    Math.max(right.width, right.height) - Math.max(left.width, left.height) ||
    left.id.localeCompare(right.id)
  );
}

type PlacedState = {
  readonly item: OutlineNestItem;
  readonly placement: NestPlacement;
  readonly paths: PathsD;
  readonly bounds: NestRect;
};

function placedState(
  item: OutlineNestItem,
  placement: NestPlacement,
  padding: number,
): PlacedState {
  const source = validOutline(item.outline)
    ? item.outline
    : rectangleOutline(item.width, item.height);
  const oriented = source.map((path) =>
    path.map((point) => {
      const rotated = placement.rotated90 ? { x: item.height - point.y, y: point.x } : point;
      return { x: rotated.x + placement.x, y: rotated.y + placement.y };
    }),
  ) as PathsD;
  const spacing = finiteNonNegative(padding) / 2;
  const paths =
    spacing === 0
      ? oriented
      : inflatePathsD(oriented, spacing, JoinType.Round, EndType.Polygon, 2, 3);
  const bounds = pathsBounds(paths) ?? placementBounds(item, placement, spacing);
  return { item, placement, paths, bounds };
}

function obstacleState(rect: NestRect, padding: number): PlacedState {
  const item: OutlineNestItem = {
    id: `obstacle:${rect.minX}:${rect.minY}:${rect.maxX}:${rect.maxY}`,
    width: rect.maxX - rect.minX,
    height: rect.maxY - rect.minY,
    canRotate: false,
  };
  return placedState(item, { id: item.id, x: rect.minX, y: rect.minY, rotated90: false }, padding);
}

function candidatePlacements(
  bin: NestRect,
  current: PlacedState,
  stationary: ReadonlyArray<PlacedState>,
): ReadonlyArray<NestPlacement> {
  const local = {
    minX: current.bounds.minX - current.placement.x,
    minY: current.bounds.minY - current.placement.y,
    maxX: current.bounds.maxX - current.placement.x,
    maxY: current.bounds.maxY - current.placement.y,
  };
  const candidates = new Map<string, NestPlacement>();
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || candidates.size >= MAX_CANDIDATES_PER_ITEM) {
      return;
    }
    const placement = { ...current.placement, x: clean(x), y: clean(y) };
    candidates.set(`${placement.x}:${placement.y}`, placement);
  };
  add(current.placement.x, current.placement.y);
  const binXs = [bin.minX - local.minX, bin.maxX - local.maxX];
  const binYs = [bin.minY - local.minY, bin.maxY - local.maxY];
  for (const x of binXs) for (const y of binYs) add(x, y);

  for (const fixed of stationary) {
    const xs = contactCoordinates(local.minX, local.maxX, fixed.bounds.minX, fixed.bounds.maxX);
    const ys = contactCoordinates(local.minY, local.maxY, fixed.bounds.minY, fixed.bounds.maxY);
    for (const x of xs) {
      add(x, binYs[0] ?? current.placement.y);
      for (const y of ys) add(x, y);
    }
    for (const y of ys) add(binXs[0] ?? current.placement.x, y);
  }
  return [...candidates.values()];
}

function contactCoordinates(
  localMin: number,
  localMax: number,
  fixedMin: number,
  fixedMax: number,
): ReadonlyArray<number> {
  return [
    fixedMin - localMin,
    fixedMax - localMin,
    fixedMin - localMax,
    fixedMax - localMax,
    (fixedMin + fixedMax - localMin - localMax) / 2,
  ];
}

function collides(
  candidate: PlacedState,
  others: ReadonlyArray<PlacedState>,
  obstacles: ReadonlyArray<PlacedState>,
): boolean {
  return [...others, ...obstacles].some((other) => {
    if (!rectanglesOverlap(candidate.bounds, other.bounds)) return false;
    const intersection = intersectD(candidate.paths, other.paths, FillRule.NonZero, 3);
    return intersection.some((path) => Math.abs(areaD(path)) > AREA_EPSILON);
  });
}

type FootprintScore = readonly [number, number, number, number, number];

function footprintScore(
  bin: NestRect,
  states: ReadonlyArray<PlacedState>,
  replacingIndex: number,
  candidate: PlacedState,
): FootprintScore {
  const bounds = states.map((state, index) =>
    index === replacingIndex ? candidate.bounds : state.bounds,
  );
  const maxX = Math.max(...bounds.map((rect) => rect.maxX));
  const maxY = Math.max(...bounds.map((rect) => rect.maxY));
  const width = maxX - bin.minX;
  const height = maxY - bin.minY;
  return [width * height, height, width, candidate.placement.y, candidate.placement.x];
}

function compareScore(left: FootprintScore, right: FootprintScore): number {
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (Math.abs(delta) > 1e-9) return delta;
  }
  return 0;
}

function inside(bin: NestRect, bounds: NestRect): boolean {
  return (
    bounds.minX >= bin.minX - 1e-7 &&
    bounds.minY >= bin.minY - 1e-7 &&
    bounds.maxX <= bin.maxX + 1e-7 &&
    bounds.maxY <= bin.maxY + 1e-7
  );
}

function rectanglesOverlap(left: NestRect, right: NestRect): boolean {
  return (
    left.minX < right.maxX - 1e-7 &&
    left.maxX > right.minX + 1e-7 &&
    left.minY < right.maxY - 1e-7 &&
    left.maxY > right.minY + 1e-7
  );
}

function pathsBounds(paths: PathsD): NestRect | null {
  const points = paths.flat();
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function placementBounds(
  item: OutlineNestItem,
  placement: NestPlacement,
  padding: number,
): NestRect {
  const width = placement.rotated90 ? item.height : item.width;
  const height = placement.rotated90 ? item.width : item.height;
  return {
    minX: placement.x - padding,
    minY: placement.y - padding,
    maxX: placement.x + width + padding,
    maxY: placement.y + height + padding,
  };
}

function validOutline(outline: NestOutline | undefined): outline is NestOutline {
  return (
    outline !== undefined &&
    outline.length > 0 &&
    outline.every(
      (path) => path.length >= 3 && path.every((point) => Number.isFinite(point.x + point.y)),
    )
  );
}

function rectangleOutline(width: number, height: number): NestOutline {
  const safeWidth = finiteNonNegative(width);
  const safeHeight = finiteNonNegative(height);
  return [
    [
      { x: 0, y: 0 },
      { x: safeWidth, y: 0 },
      { x: safeWidth, y: safeHeight },
      { x: 0, y: safeHeight },
    ],
  ];
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clean(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}
