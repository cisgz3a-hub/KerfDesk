import { sceneObjectUsesOperation, type Layer, type Scene, type SceneObject } from './scene';

type ArtworkOrderScene = Pick<Scene, 'objects' | 'artworkOrder'>;

/** Resolves persisted output priority without changing canvas stacking order. */
export function orderedArtworkObjects(scene: ArtworkOrderScene): ReadonlyArray<SceneObject> {
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const seen = new Set<string>();
  const ordered: SceneObject[] = [];
  for (const id of scene.artworkOrder ?? []) {
    const object = byId.get(id);
    if (object === undefined || seen.has(id)) continue;
    seen.add(id);
    ordered.push(object);
  }
  for (const object of scene.objects) {
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    ordered.push(object);
  }
  return ordered;
}

export function canonicalArtworkOrder(scene: ArtworkOrderScene): ReadonlyArray<string> {
  return orderedArtworkObjects(scene).map((object) => object.id);
}

export type ArtworkOperationRun = {
  readonly layer: Layer;
  // First artwork using this operation. A unified operation can include more
  // artwork, but it remains one machining unit anchored at this priority.
  readonly priorityObjectId: string;
};

/** Orders operations by their first owning artwork, then by project layer order. */
export function artworkOperationRuns(scene: Scene): ReadonlyArray<ArtworkOperationRun> {
  const runs: ArtworkOperationRun[] = [];
  const scheduled = new Set<string>();
  for (const object of orderedArtworkObjects(scene)) {
    for (const layer of scene.layers) {
      if (!layer.output || scheduled.has(layer.id) || !sceneObjectUsesOperation(object, layer)) {
        continue;
      }
      scheduled.add(layer.id);
      runs.push({ layer, priorityObjectId: object.id });
    }
  }
  return runs;
}
