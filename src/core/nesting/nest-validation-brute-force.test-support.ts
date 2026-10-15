// Independent all-pairs oracle for the validator's spatial broad phase. It
// deliberately retains the previous traversal and exact geometry predicates.
import {
  collides,
  finiteNonNegative,
  inside,
  obstacleState,
  placedState,
  placementBounds,
  rectanglesOverlap,
  validOutline,
} from './nest-outline-geometry';
import type { OutlineNestItem } from './outline-compact-nest';
import {
  allowedNestRotations,
  nestRotation,
  type NestOptions,
  type NestPlacement,
  type NestRect,
} from './quick-nest';

export function bruteForceValidateNest(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: NestOptions,
): boolean {
  try {
    return validate(bin, items, placements, options);
  } catch {
    return false;
  }
}

function validate(
  bin: NestRect,
  items: ReadonlyArray<OutlineNestItem>,
  placements: ReadonlyArray<NestPlacement>,
  options: NestOptions,
): boolean {
  if (!validDomain(bin, options)) return false;
  if (
    placements.length !== items.length ||
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
  if (states.length !== items.length || states.some((state) => !inside(bin, state.bounds)))
    return false;
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

function validDomain(bin: NestRect, options: NestOptions): boolean {
  return (
    [bin.minX, bin.minY, bin.maxX, bin.maxY, options.padding].every(Number.isFinite) &&
    bin.maxX > bin.minX &&
    bin.maxY > bin.minY &&
    options.padding >= 0 &&
    (options.obstacles ?? []).every(
      (rect) =>
        Object.values(rect).every(Number.isFinite) &&
        rect.maxX >= rect.minX &&
        rect.maxY >= rect.minY,
    )
  );
}
