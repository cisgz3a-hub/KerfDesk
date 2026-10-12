// Docking (LightBurn Arrange > Dock): move the selection left, right, up or
// down until it meets another object or the bed edge, keeping a padding.
// Collisions use bounding boxes. A stationary object whose box encloses the
// moving one is not a wall (artwork inside a frame docks past the frame's
// inner edge, as in LightBurn). Units nearest the wall move first, so a run
// of selected objects packs up against it one after another.
//   moveAsGroup: the whole selection moves as one rigid unit.
//   lockInner: a selected unit lying inside another selected unit moves with it.

import { combinedBBox, type AABB } from './hit-test';
import type { SceneGroup } from './scene';
import type { SceneObject } from './scene-object';
import type { SelectionTransform } from './selection-transform';
import { selectionUnits, type SelectionUnit } from './selection-units';

export type DockDirection = 'left' | 'right' | 'up' | 'down';

export type DockOptions = {
  readonly direction: DockDirection;
  readonly paddingMm: number;
  readonly moveAsGroup: boolean;
  readonly lockInner: boolean;
};

export type DockBed = { readonly width: number; readonly height: number };

const EPS = 1e-9;

export function buildSelectionDockEdit(
  selected: ReadonlyArray<SceneObject>,
  obstacles: ReadonlyArray<SceneObject>,
  options: DockOptions,
  bed: DockBed,
  groups: ReadonlyArray<SceneGroup> = [],
): ReadonlyArray<SelectionTransform> {
  const padding = Number.isFinite(options.paddingMm) ? Math.max(0, options.paddingMm) : 0;
  const units = dockUnits(selected, groups, options);
  const walls: AABB[] = obstacles.flatMap((object) => {
    const box = combinedBBox([object]);
    return box === null ? [] : [box];
  });
  const transforms: SelectionTransform[] = [];
  for (const unit of [...units].sort(
    (a, b) =>
      wallDistance(a.box, options.direction, bed) - wallDistance(b.box, options.direction, bed),
  )) {
    const delta = dockDelta(unit.box, walls, options.direction, padding, bed);
    const moved = shift(unit.box, options.direction, delta);
    walls.push(moved);
    if (Math.abs(delta) <= EPS) continue;
    const dx = options.direction === 'left' || options.direction === 'right' ? delta : 0;
    const dy = dx === 0 ? delta : 0;
    for (const object of unit.objects) {
      transforms.push({
        id: object.id,
        transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
      });
    }
  }
  return transforms;
}

function dockUnits(
  selected: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
  options: DockOptions,
): ReadonlyArray<SelectionUnit> {
  if (options.moveAsGroup) {
    const box = combinedBBox(selected);
    return box === null ? [] : [{ objects: selected, box }];
  }
  const units = selectionUnits(selected, groups);
  if (!options.lockInner) return units;
  // Fold each unit lying inside another into the outermost unit holding it.
  const owner = units.map((unit) =>
    units.find((other) => other !== unit && encloses(other.box, unit.box)),
  );
  return units.flatMap((unit, index) => {
    if (owner[index] !== undefined) return [];
    const inner = units.filter((_, i) => outermost(owner, units, i) === unit);
    const objects = [...unit.objects, ...inner.flatMap((member) => member.objects)];
    return [{ objects, box: unit.box }];
  });
}

function outermost(
  owner: ReadonlyArray<SelectionUnit | undefined>,
  units: ReadonlyArray<SelectionUnit>,
  index: number,
): SelectionUnit | undefined {
  let current = owner[index];
  for (let guard = 0; current !== undefined && guard < units.length; guard += 1) {
    const next = owner[units.indexOf(current)];
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

function dockDelta(
  box: AABB,
  walls: ReadonlyArray<AABB>,
  direction: DockDirection,
  padding: number,
  bed: DockBed,
): number {
  const horizontal = direction === 'left' || direction === 'right';
  const across = (wall: AABB) =>
    horizontal
      ? wall.minY < box.maxY - EPS && wall.maxY > box.minY + EPS
      : wall.minX < box.maxX - EPS && wall.maxX > box.minX + EPS;
  const blockers = walls.filter((wall) => across(wall) && !encloses(wall, box));
  switch (direction) {
    case 'left': {
      const stop = Math.max(
        padding,
        ...blockers.filter((w) => w.maxX <= box.minX + EPS).map((w) => w.maxX + padding),
      );
      return Math.min(0, stop - box.minX);
    }
    case 'right': {
      const stop = Math.min(
        bed.width - padding,
        ...blockers.filter((w) => w.minX >= box.maxX - EPS).map((w) => w.minX - padding),
      );
      return Math.max(0, stop - box.maxX);
    }
    case 'up': {
      const stop = Math.max(
        padding,
        ...blockers.filter((w) => w.maxY <= box.minY + EPS).map((w) => w.maxY + padding),
      );
      return Math.min(0, stop - box.minY);
    }
    case 'down': {
      const stop = Math.min(
        bed.height - padding,
        ...blockers.filter((w) => w.minY >= box.maxY - EPS).map((w) => w.minY - padding),
      );
      return Math.max(0, stop - box.maxY);
    }
  }
}

function wallDistance(box: AABB, direction: DockDirection, bed: DockBed): number {
  switch (direction) {
    case 'left':
      return box.minX;
    case 'right':
      return bed.width - box.maxX;
    case 'up':
      return box.minY;
    case 'down':
      return bed.height - box.maxY;
  }
}

function shift(box: AABB, direction: DockDirection, delta: number): AABB {
  const horizontal = direction === 'left' || direction === 'right';
  return horizontal
    ? { ...box, minX: box.minX + delta, maxX: box.maxX + delta }
    : { ...box, minY: box.minY + delta, maxY: box.maxY + delta };
}

function encloses(outer: AABB, inner: AABB): boolean {
  return (
    outer.minX <= inner.minX + EPS &&
    outer.minY <= inner.minY + EPS &&
    outer.maxX >= inner.maxX - EPS &&
    outer.maxY >= inner.maxY - EPS
  );
}
