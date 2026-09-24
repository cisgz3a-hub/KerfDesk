// selection-units — the rigid pieces that Align, Distribute and the board
// corner snap move. LightBurn treats a group as one object for alignment: its
// members keep their positions relative to one another and its edges and
// centres come from the whole group. Groups that share objects form one unit,
// so a group nested in another moves with the outermost one. Ungrouped objects
// are units of one. Pure — no scene mutation.

import { combinedBBox, type AABB } from './hit-test';
import type { SceneGroup } from './scene';
import type { SceneObject } from './scene-object';

export type SelectionUnit = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly box: AABB;
};

type GroupsByMember = ReadonlyMap<string, ReadonlyArray<SceneGroup>>;

/**
 * Partition `objects` into units. Units keep the order of their first member
 * in `objects`, and members keep their order within a unit. A group member
 * missing from `objects` (a locked or hidden one) belongs to no unit and its
 * box does not count, but it still joins the groups it shares.
 */
export function selectionUnits(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
): ReadonlyArray<SelectionUnit> {
  const unitKeys = unitKeyById(objects, groups);
  const members = new Map<string, SceneObject[]>();
  for (const object of objects) {
    const key = unitKeys.get(object.id) ?? object.id;
    const unit = members.get(key);
    if (unit === undefined) members.set(key, [object]);
    else unit.push(object);
  }
  return [...members.values()].flatMap((unit) => {
    const box = combinedBBox(unit);
    return box === null ? [] : [{ objects: unit, box }];
  });
}

// Keys every object by the first object of its unit.
function unitKeyById(
  objects: ReadonlyArray<SceneObject>,
  groups: ReadonlyArray<SceneGroup>,
): ReadonlyMap<string, string> {
  const groupsByMember = groupMemberships(groups);
  const keys = new Map<string, string>();
  for (const { id } of objects) {
    if (keys.has(id)) continue;
    for (const memberId of connectedIds(id, groupsByMember)) keys.set(memberId, id);
  }
  return keys;
}

// The same closure selection walks when a click on one member selects every
// group that member belongs to.
function connectedIds(start: string, groupsByMember: GroupsByMember): ReadonlyArray<string> {
  const reached = new Set([start]);
  const pending = [start];
  const walkedGroups = new Set<SceneGroup>();
  for (const id of pending) {
    for (const group of groupsByMember.get(id) ?? []) {
      if (walkedGroups.has(group)) continue;
      walkedGroups.add(group);
      for (const memberId of group.objectIds) {
        if (reached.has(memberId)) continue;
        reached.add(memberId);
        pending.push(memberId);
      }
    }
  }
  return pending;
}

function groupMemberships(groups: ReadonlyArray<SceneGroup>): GroupsByMember {
  const groupsByMember = new Map<string, SceneGroup[]>();
  for (const group of groups) {
    for (const id of group.objectIds) {
      const memberships = groupsByMember.get(id);
      if (memberships === undefined) groupsByMember.set(id, [group]);
      else memberships.push(group);
    }
  }
  return groupsByMember;
}
