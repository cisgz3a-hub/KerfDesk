import type { Scene } from './scene';

export type DesignNodeRef = { readonly kind: 'group' | 'object'; readonly id: string };
export function nodeOrderKey(ref: DesignNodeRef): string {
  return `${ref.kind}:${ref.id}`;
}
export function designNodeOrder(scene: Scene): ReadonlyArray<DesignNodeRef> {
  const fallback: DesignNodeRef[] = [
    ...(scene.groups ?? []).map((group): DesignNodeRef => ({ kind: 'group', id: group.id })),
    ...scene.objects.map((object): DesignNodeRef => ({ kind: 'object', id: object.id })),
  ];
  const available = new Map(fallback.map((ref) => [nodeOrderKey(ref), ref]));
  const result: DesignNodeRef[] = [];
  for (const ref of [...(scene.designTreeOrder ?? []), ...fallback]) {
    const key = nodeOrderKey(ref),
      found = available.get(key);
    if (found === undefined) continue;
    result.push(found);
    available.delete(key);
  }
  return result;
}
/** Optional presentation metadata can outlive deletes; preserve ranks of surviving rows. */
export function pruneDesignTreeOrder(scene: Scene): Scene {
  if (scene.designTreeOrder === undefined) return scene;
  const live = new Set([
    ...(scene.groups ?? []).map((group) => `group:${group.id}`),
    ...scene.objects.map((object) => `object:${object.id}`),
  ]);
  const seen = new Set<string>();
  const order = scene.designTreeOrder.filter((ref) => {
    const key = nodeOrderKey(ref);
    if (!live.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return order.length === scene.designTreeOrder.length
    ? scene
    : { ...scene, designTreeOrder: order };
}
export function sortDesignNodes<T>(
  scene: Scene,
  entries: ReadonlyArray<T>,
  ref: (entry: T) => DesignNodeRef,
  ranks: ReadonlyMap<string, number> = designNodeRanks(scene),
): T[] {
  return [...entries].sort(
    (a, b) =>
      (ranks.get(nodeOrderKey(ref(a))) ?? Infinity) - (ranks.get(nodeOrderKey(ref(b))) ?? Infinity),
  );
}
export function designNodeRanks(scene: Scene): ReadonlyMap<string, number> {
  return new Map(designNodeOrder(scene).map((entry, i) => [nodeOrderKey(entry), i]));
}
