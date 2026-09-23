import {
  operationIdsForObject,
  pathUsesOperation,
  type Scene,
  type SceneObject,
  type SceneGroup,
} from '../../core/scene';

/** Position in a file is not source identity. Only unambiguous unchanged
 * source content may inherit an existing component's ID and process settings. */
export function matchSvgSourceComponents(
  previous: readonly SceneObject[],
  incoming: readonly SceneObject[],
): readonly (SceneObject | undefined)[] {
  const previousKeys = previous.map(sourceContentKey);
  const incomingKeys = incoming.map(sourceContentKey);
  return incomingKeys.map((key) => {
    const index = previousKeys.indexOf(key);
    return index < 0 ||
      previousKeys.lastIndexOf(key) !== index ||
      incomingKeys.indexOf(key) !== incomingKeys.lastIndexOf(key)
      ? undefined
      : previous[index];
  });
}

function sourceContentKey(object: SceneObject): string {
  const transform = object.svgImport?.transform ?? object.transform;
  const mode = object.svgImport?.mode ?? svgSourceMode(object);
  const content =
    object.kind === 'raster-image'
      ? {
          dataUrl: object.dataUrl,
          imageAsset: object.imageAsset,
          bounds: object.bounds,
          imageClip: object.imageClip,
        }
      : 'paths' in object
        ? object.paths.map(({ color, fillRule, polylines, curves }) => ({
            color,
            fillRule,
            polylines,
            curves,
          }))
        : object;
  return JSON.stringify({ kind: object.kind, transform, mode, content });
}

export function svgSourceMode(object: SceneObject): 'line' | 'fill' | 'image' {
  return object.kind === 'raster-image' ? 'image' : (object.operationOverride?.mode ?? 'line');
}

export function inheritSvgComponentOperations(
  incoming: SceneObject,
  previous: SceneObject,
  sourceScene: Scene,
): SceneObject {
  const { operationOverride: _sourceMode, ...clean } = incoming;
  const operationIds = operationIdsForObject(previous, sourceScene.layers);
  const base = {
    ...clean,
    operationIds,
    ...(previous.operationOverride === undefined
      ? {}
      : { operationOverride: previous.operationOverride }),
  } as SceneObject;
  if (!('paths' in base) || !('paths' in previous)) return base;
  return {
    ...base,
    paths: base.paths.map((path, index) => {
      const priorPath = previous.paths[index];
      if (priorPath === undefined) throw new Error('SVG source path identity changed.');
      const ids = sourceScene.layers
        .filter((layer) => pathUsesOperation(previous, priorPath, layer))
        .map((layer) => layer.id);
      return { ...path, operationIds: ids };
    }),
  } as SceneObject;
}

export function replaceSvgArtworkOrder(
  original: Scene,
  removed: ReadonlySet<string>,
  inserted: readonly string[],
): readonly string[] | undefined {
  if (original.artworkOrder === undefined) return undefined;
  const retained = new Set(inserted);
  const newIds = inserted.filter((id) => !removed.has(id));
  const order = original.artworkOrder.flatMap((id) =>
    !removed.has(id) || retained.has(id) ? [id] : [],
  );
  const anchor = original.artworkOrder.findIndex((id) => removed.has(id));
  const beforeAnchor = original.artworkOrder
    .slice(0, anchor < 0 ? original.artworkOrder.length : anchor)
    .filter((id) => !removed.has(id)).length;
  order.splice(beforeAnchor, 0, ...newIds);
  return order;
}

export function replaceSvgGroups(
  original: Scene,
  removed: ReadonlySet<string>,
  prepared: Scene,
  inserted: readonly string[],
): readonly SceneGroup[] {
  const retained = new Set(inserted);
  const groups = (original.groups ?? [])
    .map((group) => {
      const ownsSource = [...removed].every((id) => group.objectIds.includes(id));
      const objectIds = ownsSource
        ? [...group.objectIds.filter((id) => !removed.has(id)), ...inserted]
        : group.objectIds.filter((id) => !removed.has(id) || retained.has(id));
      return { ...group, objectIds };
    })
    .filter((group) => group.objectIds.length > 1);
  if (
    inserted.length > 1 &&
    !groups.some((group) => inserted.every((id) => group.objectIds.includes(id)))
  ) {
    const sourceGroup = prepared.groups?.at(-1);
    if (sourceGroup !== undefined) groups.push(sourceGroup);
  }
  return groups;
}
