import { isPaperWhite, knockOutWhiteFills } from '../../core/geometry/white-fill-knockout';
import {
  operationIdsForObject,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type Scene,
  type SceneObject,
  type SceneGroup,
} from '../../core/scene';

/** An earlier component an incoming one inherits from. A component whose white
 * the import knocked out maps each incoming path to the path it became
 * (`pathMap`); undefined marks a path the knock-out left out. */
export type SvgSourceMatch = {
  readonly prior: SceneObject;
  readonly pathMap?: ReadonlyArray<number | undefined>;
};

/** Position in a file is not source identity. Only unambiguous unchanged
 * source content may inherit an existing component's ID and process settings. */
export function matchSvgSourceComponents(
  previous: readonly SceneObject[],
  incoming: readonly SceneObject[],
): readonly (SceneObject | undefined)[] {
  return matchSvgSources(previous, incoming).map((match) => match?.prior);
}

/**
 * As matchSvgSourceComponents, but an earlier component the import's white
 * knock-out rewrote (ADR-686) is matched as the knock-out would rewrite the
 * incoming source, so an unchanged Re-import keeps its operations
 * (ADR-358 Decision 6, ADR-686 Amendment 3).
 */
export function matchSvgSources(
  previous: readonly SceneObject[],
  incoming: readonly SceneObject[],
): readonly (SvgSourceMatch | undefined)[] {
  const previousKeys = previous.map(sourceContentKey);
  const parsedKeys = incoming.map(sourceContentKey);
  const knocked = knockedSources(incoming);
  const knockedKeys = incoming.map((_object, index) => {
    const result = knocked[index];
    return result === undefined ? parsedKeys[index] : result && sourceContentKey(result.object);
  });
  const claimed = new Set<SceneObject>();
  const find = (key: string | null | undefined, keys: readonly (string | null | undefined)[]) => {
    if (key === null || key === undefined || keys.indexOf(key) !== keys.lastIndexOf(key)) return;
    const index = previousKeys.indexOf(key);
    if (index < 0 || previousKeys.lastIndexOf(key) !== index) return;
    const prior = previous[index];
    return prior === undefined || claimed.has(prior) ? undefined : prior;
  };
  return incoming.map((_object, index) => {
    const parsed = find(parsedKeys[index], parsedKeys);
    const result = knocked[index];
    const prior = parsed ?? (result ? find(knockedKeys[index], knockedKeys) : undefined);
    if (prior === undefined) return undefined;
    claimed.add(prior);
    return parsed !== undefined || !result ? { prior } : { prior, pathMap: result.pathMap };
  });
}

type KnockedSource = {
  readonly object: SceneObject;
  readonly pathMap: ReadonlyArray<number | undefined>;
};

// What the import's knock-out makes of each incoming component: undefined when
// it leaves the component alone, null when it removes the whole component.
function knockedSources(incoming: readonly SceneObject[]): (KnockedSource | null | undefined)[] {
  const knockout = knockOutWhiteFills(incoming);
  if (knockout === null || knockout.removedIds.size === incoming.length)
    return incoming.map(() => undefined);
  return incoming.map((object) => {
    if (knockout.removedIds.has(object.id)) return null;
    const changed = knockout.changed.get(object.id);
    const kept = knockout.keptPaths.get(object.id);
    if (changed === undefined || kept === undefined || !('paths' in object)) return undefined;
    const pathMap = object.paths.map((_path, index) => {
      const at = kept.indexOf(index);
      return at < 0 ? undefined : at;
    });
    return { object: changed, pathMap };
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
            // A knocked path holds polylines only until Save writes their curves.
            curves: curves ?? polylines.map(polylineToCurveSubpath),
          }))
        : object;
  return JSON.stringify({ kind: object.kind, transform, mode, content });
}

// A white the operator chose to burn stays their choice through an unchanged
// Re-import (ADR-686 Amendment 3).
function keptWhiteChoice(path: ColoredPath, priorPath: ColoredPath): ColoredPath {
  return priorPath.whiteInk === 'kept' && isPaperWhite(path) ? { ...path, whiteInk: 'kept' } : path;
}

// A path the knock-out left out of the earlier component has no operation of
// its own yet; prepareFragmentObject gives it one (knockedPathOperations).
function unboundPath(path: ColoredPath): ColoredPath {
  const { operationIds: _ids, ...rest } = path;
  return rest;
}

export function svgSourceMode(object: SceneObject): 'line' | 'fill' | 'image' {
  return object.kind === 'raster-image' ? 'image' : (object.operationOverride?.mode ?? 'line');
}

export function inheritSvgComponentOperations(
  incoming: SceneObject,
  previous: SceneObject,
  sourceScene: Scene,
  pathMap?: ReadonlyArray<number | undefined>,
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
      if (pathMap !== undefined && pathMap[index] === undefined) return unboundPath(path);
      const priorPath = previous.paths[pathMap?.[index] ?? index];
      if (priorPath === undefined) throw new Error('SVG source path identity changed.');
      const ids = sourceScene.layers
        .filter((layer) => pathUsesOperation(previous, priorPath, layer))
        .map((layer) => layer.id);
      return { ...keptWhiteChoice(path, priorPath), operationIds: ids };
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
  const groups: SceneGroup[] = (original.groups ?? [])
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
