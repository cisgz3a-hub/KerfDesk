import type { Scene } from '../../core/scene';

/** Cache connected group units, including nested and overlapping memberships, without a cap.
 * A large existing group must still be removable; only the resulting selection is bounded.
 */
export function selectionUnits(scene: Scene): (id: string) => readonly string[] {
  const memberships = new Map<string, (readonly string[])[]>();
  for (const group of scene.groups ?? []) {
    for (const id of group.objectIds) {
      const groups = memberships.get(id) ?? [];
      groups.push(group.objectIds);
      memberships.set(id, groups);
    }
  }
  const cache = new Map<string, readonly string[]>();
  return (id) => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const pending = [id];
    const seen = new Set(pending);
    const expanded = new Set<readonly string[]>();
    for (const member of pending) {
      for (const group of memberships.get(member) ?? []) {
        if (expanded.has(group)) continue;
        expanded.add(group);
        for (const sibling of group) {
          if (seen.has(sibling)) continue;
          seen.add(sibling);
          pending.push(sibling);
        }
      }
    }
    for (const member of pending) cache.set(member, pending);
    return pending;
  };
}
