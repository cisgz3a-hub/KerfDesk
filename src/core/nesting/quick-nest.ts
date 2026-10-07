export type NestRect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type NestItem = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly canRotate: boolean;
  /** Allowed turns relative to the artwork's current orientation. */
  readonly rotationAngles?: ReadonlyArray<NestRotation>;
};

export type NestRotation = 0 | 90 | 180 | 270;

export type NestOptions = {
  readonly padding: number;
  readonly obstacles?: ReadonlyArray<NestRect>;
  readonly itemOrder?: ReadonlyArray<string>;
};

export type NestPlacement = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly rotated90: boolean;
  readonly rotationDeg?: NestRotation;
};

export type QuickNestResult =
  | { readonly ok: true; readonly placements: ReadonlyArray<NestPlacement> }
  | { readonly ok: false; readonly unplacedIds: ReadonlyArray<string> };

type Candidate = NestPlacement & {
  readonly packed: NestRect;
  readonly shortSide: number;
  readonly longSide: number;
};

export function quickNest(
  bin: NestRect,
  items: ReadonlyArray<NestItem>,
  options: NestOptions,
): QuickNestResult {
  if (!validRect(bin)) return { ok: false, unplacedIds: items.map((item) => item.id) };
  const padding = finiteNonNegative(options.padding);
  const inset = padding / 2;
  let free = insetRect(bin, inset);
  if (free.length === 0) return { ok: false, unplacedIds: items.map((item) => item.id) };
  for (const obstacle of options.obstacles ?? []) {
    free = subtractUsed(free, expandRect(obstacle, inset));
  }
  const ordered = orderNestItems(items, options.itemOrder);
  const placements: NestPlacement[] = [];
  const unplacedIds: string[] = [];
  for (const item of ordered) {
    const candidate = bestCandidate(free, item, padding);
    if (candidate === null) {
      unplacedIds.push(item.id);
      continue;
    }
    placements.push({
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      rotated90: candidate.rotated90,
      ...(candidate.rotationDeg === undefined ? {} : { rotationDeg: candidate.rotationDeg }),
    });
    free = subtractUsed(free, candidate.packed);
  }
  return unplacedIds.length === 0 ? { ok: true, placements } : { ok: false, unplacedIds };
}

function bestCandidate(
  freeRects: ReadonlyArray<NestRect>,
  item: NestItem,
  padding: number,
): Candidate | null {
  const dimensions = allowedNestRotations(item).map((angle) => ({
    width: angle % 180 === 0 ? item.width : item.height,
    height: angle % 180 === 0 ? item.height : item.width,
    ...nestTurn(angle),
  }));
  let best: Candidate | null = null;
  for (const rect of freeRects) {
    for (const dimension of dimensions) {
      const packedWidth = finiteNonNegative(dimension.width) + padding;
      const packedHeight = finiteNonNegative(dimension.height) + padding;
      const remainingX = width(rect) - packedWidth;
      const remainingY = height(rect) - packedHeight;
      if (remainingX < 0 || remainingY < 0) continue;
      const candidate: Candidate = {
        id: item.id,
        x: rect.minX + padding / 2,
        y: rect.minY + padding / 2,
        rotated90: dimension.rotated90,
        ...(dimension.rotationDeg === undefined ? {} : { rotationDeg: dimension.rotationDeg }),
        packed: {
          minX: rect.minX,
          minY: rect.minY,
          maxX: rect.minX + packedWidth,
          maxY: rect.minY + packedHeight,
        },
        shortSide: Math.min(remainingX, remainingY),
        longSide: Math.max(remainingX, remainingY),
      };
      if (best === null || compareCandidates(candidate, best) < 0) best = candidate;
    }
  }
  return best;
}

function subtractUsed(freeRects: ReadonlyArray<NestRect>, used: NestRect): NestRect[] {
  return pruneContained(freeRects.flatMap((free) => splitFreeRect(free, used)));
}

function splitFreeRect(free: NestRect, used: NestRect): NestRect[] {
  if (!intersects(free, used)) return [free];
  const pieces: NestRect[] = [];
  if (used.minX > free.minX) pieces.push({ ...free, maxX: Math.min(used.minX, free.maxX) });
  if (used.maxX < free.maxX) pieces.push({ ...free, minX: Math.max(used.maxX, free.minX) });
  if (used.minY > free.minY) pieces.push({ ...free, maxY: Math.min(used.minY, free.maxY) });
  if (used.maxY < free.maxY) pieces.push({ ...free, minY: Math.max(used.maxY, free.minY) });
  return pieces.filter(validRect);
}

function pruneContained(rects: ReadonlyArray<NestRect>): NestRect[] {
  return rects.filter(
    (rect, index) =>
      !rects.some((other, otherIndex) => otherIndex !== index && contains(other, rect)),
  );
}

function compareItems(a: NestItem, b: NestItem): number {
  return (
    b.width * b.height - a.width * a.height ||
    Math.max(b.width, b.height) - Math.max(a.width, a.height) ||
    a.id.localeCompare(b.id)
  );
}

export function allowedNestRotations(item: NestItem): ReadonlyArray<NestRotation> {
  return item.rotationAngles === undefined
    ? item.canRotate
      ? [0, 90]
      : [0]
    : [...new Set(item.rotationAngles)].filter((angle) => [0, 90, 180, 270].includes(angle));
}

export function nestTurn(angle: NestRotation): Pick<NestPlacement, 'rotated90' | 'rotationDeg'> {
  return {
    rotated90: angle % 180 !== 0,
    ...(angle === 180 || angle === 270 ? { rotationDeg: angle } : {}),
  };
}

export function nestRotation(placement: NestPlacement): NestRotation {
  return placement.rotationDeg ?? (placement.rotated90 ? 90 : 0);
}

export function orderNestItems<T extends NestItem>(
  items: ReadonlyArray<T>,
  order?: ReadonlyArray<string>,
): T[] {
  if (order === undefined) return [...items].sort(compareItems);
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || compareItems(a, b),
  );
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.shortSide - b.shortSide ||
    a.longSide - b.longSide ||
    a.packed.minY - b.packed.minY ||
    a.packed.minX - b.packed.minX ||
    Number(a.rotated90) - Number(b.rotated90)
  );
}

function insetRect(rect: NestRect, amount: number): NestRect[] {
  const inset = {
    minX: rect.minX + amount,
    minY: rect.minY + amount,
    maxX: rect.maxX - amount,
    maxY: rect.maxY - amount,
  };
  return validRect(inset) ? [inset] : [];
}

function expandRect(rect: NestRect, amount: number): NestRect {
  return {
    minX: rect.minX - amount,
    minY: rect.minY - amount,
    maxX: rect.maxX + amount,
    maxY: rect.maxY + amount,
  };
}

function validRect(rect: NestRect): boolean {
  return (
    [rect.minX, rect.minY, rect.maxX, rect.maxY].every(Number.isFinite) &&
    width(rect) > 0 &&
    height(rect) > 0
  );
}

function width(rect: NestRect): number {
  return rect.maxX - rect.minX;
}

function height(rect: NestRect): number {
  return rect.maxY - rect.minY;
}

function intersects(a: NestRect, b: NestRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function contains(outer: NestRect, inner: NestRect): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
