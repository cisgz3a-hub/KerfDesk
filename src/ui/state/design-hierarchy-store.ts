import { create } from 'zustand';
import type { Scene } from '../../core/scene';

export const useDesignHierarchyStore = create<{
  readonly focusId: string | null;
  readonly documentEpoch: number;
}>(() => ({ focusId: null, documentEpoch: -1 }));
// The composed project store attaches this observer after construction. Keeping
// the dependency one-way avoids a module-initialization cycle through group actions.
export function observeDesignHierarchyDocument<
  State extends { readonly projectDocumentEpoch: number },
>(subscribe: (listener: (next: State, previous: State) => void) => () => void): () => void {
  return subscribe((next, previous) => {
    if (next.projectDocumentEpoch !== previous.projectDocumentEpoch)
      useDesignHierarchyStore.setState({
        focusId: null,
        documentEpoch: next.projectDocumentEpoch,
      });
  });
}

export function focusDesignHierarchy(id: string | null, epoch: number): void {
  useDesignHierarchyStore.setState({ focusId: id, documentEpoch: epoch });
}

export function currentHierarchyFocus(scene: Scene, epoch: number | undefined): string | null {
  const focus = useDesignHierarchyStore.getState();
  return focus.documentEpoch === epoch &&
    (scene.groups ?? []).some((group) => group.id === focus.focusId)
    ? focus.focusId
    : null;
}

export function isInsideGroup(
  groups: NonNullable<Scene['groups']>,
  id: string,
  ancestorId: string,
): boolean {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor !== undefined && !seen.has(cursor.id)) {
    if (cursor.parentId === ancestorId) return true;
    seen.add(cursor.id);
    cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
  }
  return false;
}

export function groupsWithinFocus(
  groups: NonNullable<Scene['groups']>,
  focusId: string | null,
): NonNullable<Scene['groups']> {
  if (focusId === null) return groups;
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (group.parentId === undefined) continue;
    const ids = children.get(group.parentId) ?? [];
    ids.push(group.id);
    children.set(group.parentId, ids);
  }
  const pending = [...(children.get(focusId) ?? [])];
  const allowed = new Set<string>();
  for (const id of pending) {
    if (allowed.has(id)) continue;
    allowed.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return groups.filter((group) => allowed.has(group.id));
}
