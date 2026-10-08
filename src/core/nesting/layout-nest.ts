import { outlineNest, validateNest, type OutlineNestItem } from './outline-compact-nest';
import {
  allowedNestRotations,
  nestTurn,
  quickNest,
  type NestOptions,
  type NestPlacement,
  type NestRect,
} from './quick-nest';

export type NestGoal = 'tidy' | 'compact' | 'grid';
export type NestingInput = NestOptions & {
  readonly bin: NestRect;
  readonly items: ReadonlyArray<OutlineNestItem>;
  readonly goal: NestGoal;
  readonly method: 'fast' | 'outline';
  readonly optimise: boolean;
};
export type NestLayout = {
  readonly placements: ReadonlyArray<NestPlacement>;
  readonly usedOutline: boolean;
  readonly footprintAreaMm2: number;
  readonly stockUtilisationPercent: number;
  readonly layoutUtilisationPercent: number;
  readonly boundsFallbackUnits: number;
};
export type NestingProgress = {
  readonly attempted: number;
  readonly total: number;
  readonly best: NestLayout | null;
};

/** A deterministic search budget, never a part-count admission limit. The UI
 * owns a worker and can terminate a trial without losing an earlier result. */
export function* searchNestLayouts(input: NestingInput): Generator<NestingProgress> {
  const total = input.optimise ? 24 : 1;
  let best: NestLayout | null = null;
  for (let trial = 0; trial < total; trial += 1) {
    const candidate = layoutNest(input, trial);
    if (
      candidate !== null &&
      (best === null || candidate.footprintAreaMm2 < best.footprintAreaMm2)
    ) {
      best = candidate;
    }
    yield { attempted: trial + 1, total, best };
  }
}

export function layoutNest(input: NestingInput, trial = 0): NestLayout | null {
  const items = orderedItems(input, trial);
  const options = { ...input, itemOrder: items.map((item) => item.id) };
  const result =
    input.goal === 'grid'
      ? gridNest(input.bin, items, options, trial)
      : input.goal === 'compact' &&
          input.method === 'outline' &&
          items.some((item) => item.outline !== undefined)
        ? outlineNest(input.bin, items, options)
        : quickNest(input.bin, items, options);
  if (!result.ok) return null;
  const usedOutline = 'usedOutline' in result && result.usedOutline === true;
  const validationItems = usedOutline
    ? input.items
    : input.items.map(({ outline: _outline, ...item }) => item);
  if (!validateNest(input.bin, validationItems, result.placements, input)) return null;
  return describeNestLayout(input, result.placements, usedOutline);
}

export function describeNestLayout(
  input: NestingInput,
  placements: ReadonlyArray<NestPlacement>,
  usedOutline: boolean,
): NestLayout {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  let maxX = input.bin.minX;
  let maxY = input.bin.minY;
  let occupied = 0;
  for (const placement of placements) {
    const item = byId.get(placement.id);
    if (item === undefined) continue;
    maxX = Math.max(
      maxX,
      placement.x + (placement.rotated90 ? item.height : item.width) + input.padding / 2,
    );
    maxY = Math.max(
      maxY,
      placement.y + (placement.rotated90 ? item.width : item.height) + input.padding / 2,
    );
    occupied +=
      usedOutline && item.outline !== undefined ? outlineArea(item) : item.width * item.height;
  }
  const footprintAreaMm2 = (maxX - input.bin.minX) * (maxY - input.bin.minY);
  const stockArea = (input.bin.maxX - input.bin.minX) * (input.bin.maxY - input.bin.minY);
  return {
    placements,
    usedOutline,
    footprintAreaMm2,
    stockUtilisationPercent: percent(occupied, stockArea),
    layoutUtilisationPercent: percent(occupied, footprintAreaMm2),
    boundsFallbackUnits: usedOutline
      ? input.items.filter((item) => item.outline === undefined).length
      : input.items.length,
  };
}

function orderedItems(input: NestingInput, trial: number): OutlineNestItem[] {
  const items = [...input.items];
  if (input.goal === 'tidy' && trial === 0) {
    return items.sort(
      (a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id),
    );
  }
  const comparators = [
    (a: OutlineNestItem, b: OutlineNestItem) => b.width * b.height - a.width * a.height,
    (a: OutlineNestItem, b: OutlineNestItem) => b.height - a.height || b.width - a.width,
    (a: OutlineNestItem, b: OutlineNestItem) => b.width - a.width || b.height - a.height,
    (a: OutlineNestItem, b: OutlineNestItem) => a.width * a.height - b.width * b.height,
  ];
  const compare = comparators[trial];
  if (compare !== undefined) return items.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  // Seeded Fisher-Yates explores new orders without changing source identities.
  let seed = trial;
  for (let index = items.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    const left = items[index];
    const right = items[target];
    if (left !== undefined && right !== undefined) {
      items[index] = right;
      items[target] = left;
    }
  }
  return items;
}

function gridNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  options: NestOptions,
  trial: number,
): ReturnType<typeof quickNest> {
  const padding = Math.max(0, options.padding);
  const oriented = items.map((item) => {
    const angles = allowedNestRotations(item);
    return { item, turn: nestTurn(angles[trial % angles.length] ?? 0) };
  });
  const cellWidth =
    Math.max(...oriented.map(({ item, turn }) => (turn.rotated90 ? item.height : item.width))) +
    padding;
  const cellHeight =
    Math.max(...oriented.map(({ item, turn }) => (turn.rotated90 ? item.width : item.height))) +
    padding;
  const columns = Math.floor((bin.maxX - bin.minX) / cellWidth);
  const rows = Math.floor((bin.maxY - bin.minY) / cellHeight);
  if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns <= 0 || rows <= 0) {
    return { ok: false, unplacedIds: items.map((item) => item.id) };
  }
  const placements: NestPlacement[] = [];
  let cell = 0;
  for (const { item, turn } of oriented) {
    let placed = false;
    while (cell < columns * rows) {
      const placement = {
        id: item.id,
        x: bin.minX + (cell % columns) * cellWidth + padding / 2,
        y: bin.minY + Math.floor(cell / columns) * cellHeight + padding / 2,
        ...turn,
      };
      cell += 1;
      const width = turn.rotated90 ? item.height : item.width;
      const height = turn.rotated90 ? item.width : item.height;
      if (
        (options.obstacles ?? []).some(
          (obstacle) =>
            placement.x - padding < obstacle.maxX &&
            placement.x + width + padding > obstacle.minX &&
            placement.y - padding < obstacle.maxY &&
            placement.y + height + padding > obstacle.minY,
        )
      )
        continue;
      placements.push(placement);
      placed = true;
      break;
    }
    if (!placed)
      return {
        ok: false,
        unplacedIds: items
          .filter((entry) => !placements.some((p) => p.id === entry.id))
          .map((entry) => entry.id),
      };
  }
  return { ok: true, placements };
}

function outlineArea(item: OutlineNestItem): number {
  const signed = (item.outline ?? []).reduce(
    (sum, path) =>
      sum +
      path.reduce((area, point, index) => {
        const next = path[(index + 1) % path.length];
        return next === undefined ? area : area + point.x * next.y - next.x * point.y;
      }, 0) /
        2,
    0,
  );
  return Math.min(item.width * item.height, Math.abs(signed));
}

function percent(area: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, (area / total) * 100)) : 0;
}
