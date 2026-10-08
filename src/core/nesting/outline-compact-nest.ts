import {
  placedState,
  obstacleState,
  collides,
  inside,
  rectanglesOverlap,
  placementBounds,
  validOutline,
  finiteNonNegative,
  type PlacedState,
} from './nest-outline-geometry';
import {
  quickNest,
  allowedNestRotations,
  nestRotation,
  nestTurn,
  orderNestItems,
  type NestItem,
  type NestOptions,
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

export const OUTLINE_NEST_ITEM_LIMIT = 32;
const OUTLINE_NEST_WORK_LIMIT = 250_000;
const MAX_CANDIDATES_PER_ITEM = 4_000;

export function outlineNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  options: NestOptions,
): OutlineNestResult {
  if (!isOutlineNestWithinWorkBudget(items)) {
    const result = quickNest(bin, items, options);
    return result.ok ? { ...result, usedOutline: false } : result;
  }
  const rectangular = quickNest(bin, items, options);
  try {
    const seeds = [
      ...(rectangular.ok ? [rectangular.placements] : []),
      stagingPlacements(bin, items, options, 0, 'row'),
      stagingPlacements(bin, items, options, 1, 'row'),
      stagingPlacements(bin, items, options, 0, 'column'),
      stagingPlacements(bin, items, options, 2, 'row'),
      stagingPlacements(bin, items, options, 3, 'row'),
    ];
    let best: ReadonlyArray<NestPlacement> | null = null;
    let bestScore: readonly [number, number, number] | null = null;
    for (const seed of seeds) {
      const placements = compactOutlineNest(bin, items, seed, options);
      if (!validateNest(bin, items, placements, options)) continue;
      const score = placementScore(bin, items, placements, options.padding);
      if (bestScore === null || comparePlacementScore(score, bestScore) < 0) {
        best = placements;
        bestScore = score;
      }
    }
    return best === null
      ? rectangular.ok
        ? { ...rectangular, usedOutline: false }
        : { ok: false, unplacedIds: items.map((item) => item.id) }
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
  options: NestOptions,
): ReadonlyArray<NestPlacement> {
  if (!isOutlineNestWithinWorkBudget(items)) return placements;
  try {
    return compactOutlineNestUnsafe(bin, items, placements, options);
  } catch {
    return placements;
  }
}

export function isOutlineNestWithinWorkBudget(items: ReadonlyArray<OutlineNestItem>): boolean {
  if (items.length === 0 || items.length > OUTLINE_NEST_ITEM_LIMIT) return false;
  const itemPairCount = items.length * items.length;
  let outlinePoints = 0;
  for (const item of items) {
    if (item.outline === undefined || item.outline.length === 0) outlinePoints += 4;
    else for (const path of item.outline) outlinePoints += path.length;
    if (itemPairCount * outlinePoints > OUTLINE_NEST_WORK_LIMIT) return false;
  }
  return true;
}

function compactOutlineNestUnsafe(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: NestOptions,
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
  options: NestOptions,
  orientationIndex: number,
  direction: 'row' | 'column',
): ReadonlyArray<NestPlacement> {
  const gap = finiteNonNegative(options.padding);
  let x = bin.minX + gap / 2;
  let y = bin.minY + gap / 2;
  return orderNestItems(items, options.itemOrder).map((item) => {
    const angles = allowedNestRotations(item);
    const turn = nestTurn(angles[orientationIndex % angles.length] ?? 0);
    const { rotated90 } = turn;
    const placement = { id: item.id, x, y, ...turn };
    const width = rotated90 ? item.height : item.width;
    const height = rotated90 ? item.width : item.height;
    if (direction === 'row') x += width + gap;
    else y += height + gap;
    return placement;
  });
}

/** Validate worker results again before accepting any scene mutation. */
export function validateNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: NestOptions,
): boolean {
  try {
    return validateNestUnsafe(bin, items, placements, options);
  } catch {
    return false;
  }
}

function validateNestUnsafe(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: NestOptions,
): boolean {
  if (!validNestDomain(bin, options)) return false;
  if (placements.length !== items.length) return false;
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    new Set(placements.map((placement) => placement.id)).size !== items.length ||
    items.some(
      (item) =>
        !Number.isFinite(item.width) ||
        !Number.isFinite(item.height) ||
        item.width <= 0 ||
        item.height <= 0,
    )
  )
    return false;
  const byId = new Map(items.map((item) => [item.id, item]));
  if (
    placements.some((placement) => {
      const item = byId.get(placement.id);
      return (
        item === undefined ||
        ![placement.x, placement.y].every(Number.isFinite) ||
        !allowedNestRotations(item).includes(nestRotation(placement)) ||
        placement.rotated90 !== (nestRotation(placement) % 180 !== 0)
      );
    })
  )
    return false;
  if (items.every((item) => !validOutline(item.outline))) {
    const rectangles = placements.flatMap((placement) => {
      const item = byId.get(placement.id);
      return item === undefined
        ? []
        : [placementBounds(item, placement, finiteNonNegative(options.padding) / 2)];
    });
    const obstacles = (options.obstacles ?? []).map((rect) => ({
      minX: rect.minX - options.padding / 2,
      minY: rect.minY - options.padding / 2,
      maxX: rect.maxX + options.padding / 2,
      maxY: rect.maxY + options.padding / 2,
    }));
    return rectangles.every(
      (rect, index) =>
        inside(bin, rect) &&
        ![...rectangles.slice(index + 1), ...obstacles].some((other) =>
          rectanglesOverlap(rect, other),
        ),
    );
  }
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
function validNestDomain(bin: NestRect, options: NestOptions): boolean {
  if (![bin.minX, bin.minY, bin.maxX, bin.maxY, options.padding].every(Number.isFinite))
    return false;
  if (bin.maxX <= bin.minX || bin.maxY <= bin.minY || options.padding < 0) return false;
  return (options.obstacles ?? []).every(
    (rect) =>
      Object.values(rect).every(Number.isFinite) &&
      rect.maxX >= rect.minX &&
      rect.maxY >= rect.minY,
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

function clean(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}
