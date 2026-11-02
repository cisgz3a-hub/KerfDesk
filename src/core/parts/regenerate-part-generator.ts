import type { ColoredPath, ImportedSvg, CncTabAnchor } from '../scene/scene-object';
import { polylineToCurveSubpath } from '../scene/curve-path';
import { withClosedPathEdges } from '../scene/polyline-closure';
import { subpathGeometryKey } from '../scene/subpath-nesting';
import { sameRecipeValue } from '../material-library/process-recipe';
import type {
  PartGeneratorDefinition,
  PartGeneratorGeometry,
  PartGeneratorResult,
  GeneratedPartObject,
} from './part-generator';
import { materializePartGenerator } from './materialize-part-generator';
import { withUnitScale } from '../scene/retained-source-scale';
import { placedTabCount } from '../scene/object-tab-anchors';
import { withTabsFollowingRebuiltContours } from '../geometry/rebuilt-contour-tabs';

/** A regenerated part, and what the rebuild did to its tabs placed by hand. */
export type RegeneratedPart = {
  readonly object: GeneratedPartObject;
  /** Tabs with no matching edge on the new outline, moved to the nearest point of it. */
  readonly movedTabs: number;
  /** Tabs on paths the new dimensions removed. */
  readonly removedTabs: number;
};

export function regeneratePartGenerator(
  object: GeneratedPartObject,
  definition: PartGeneratorDefinition,
): PartGeneratorResult<RegeneratedPart> {
  const materialized = materializePartGenerator(definition);
  if (materialized.kind === 'invalid') return materialized;
  const retained = retainedPartPaths(object);
  if (retained.kind === 'invalid') return retained;
  const geometry = materialized.value;
  const paths = geometry.paths.map((path, index) =>
    retainPathSettings(object, geometry.source.pathKeys[index] ?? 'boundary', retained.value, path),
  );
  const { currentKeys } = retained.value;
  const { pathKeys } = geometry.source;
  const rebuilt: GeneratedPartObject = {
    ...object,
    // The definition is the size that burns (ADR-573 Amendment 1).
    transform: withUnitScale(object.transform),
    bounds: geometry.bounds,
    paths,
    partGenerator: geometry.source,
    ...(object.name === object.partGenerator.definition.name ? { name: definition.name } : {}),
    ...(object.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: retainTabs(object.cncTabAnchors, currentKeys, pathKeys) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: retainTabs(object.laserTabAnchors, currentKeys, pathKeys) }),
  };
  const followed = withTabsFollowingRebuiltContours(object, rebuilt, (pathIndex) => {
    const previous = currentKeys.indexOf(pathKeys[pathIndex] ?? '');
    return previous < 0 ? undefined : previous;
  });
  return {
    kind: 'ok',
    value: {
      object: followed.object,
      movedTabs: followed.moved,
      removedTabs: placedTabCount(object) - placedTabCount(followed.object),
    },
  };
}
type RetainedPartPaths = {
  readonly settings: ReadonlyMap<string, ColoredPath>;
  readonly currentKeys: readonly string[];
};

/** Retained keys describe generated order, never a manually reordered path array. */
function retainedPartPaths(object: GeneratedPartObject): PartGeneratorResult<RetainedPartPaths> {
  const original = materializePartGenerator(object.partGenerator.definition);
  if (original.kind === 'invalid') return original;
  const geometry = original.value;
  if (
    object.paths.length !== geometry.paths.length ||
    !sameRecipeValue(object.partGenerator.pathKeys, geometry.source.pathKeys)
  )
    return ambiguousBindings();
  const candidates = new Map<string, { readonly path: ColoredPath; readonly key: string }[]>();
  for (const [index, path] of geometry.paths.entries()) {
    const key = geometry.source.pathKeys[index];
    if (key === undefined) return ambiguousBindings();
    const stamp = subpathGeometryKey(path);
    const entries = candidates.get(stamp) ?? [];
    entries.push({ path, key });
    candidates.set(stamp, entries);
  }
  const settings = new Map<string, ColoredPath>();
  const currentKeys: string[] = [];
  for (const current of object.paths) {
    const matches = (candidates.get(subpathGeometryKey(withClosedPathEdges(current))) ?? []).filter(
      ({ path }) => samePartPathGeometry(path, current),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match === undefined || settings.has(match.key)) return ambiguousBindings();
    settings.set(match.key, current);
    currentKeys.push(match.key);
  }
  return { kind: 'ok', value: { settings, currentKeys } };
}
function ambiguousBindings(): PartGeneratorResult<never> {
  return {
    kind: 'invalid',
    reason:
      'Cannot safely recover the generated part’s machining bindings. Undo manual geometry edits or bake this generated part before regenerating.',
  };
}
function samePartPathGeometry(generated: ColoredPath, saved: ColoredPath): boolean {
  // Parts saved before the generator emitted its closing edge still bind.
  const current = withClosedPathEdges(saved);
  return (
    sameRecipeValue(
      generated.curves,
      current.curves ?? current.polylines.map(polylineToCurveSubpath),
    ) && sameRecipeValue(generated.polylines, current.polylines)
  );
}
function retainPathSettings(
  object: GeneratedPartObject,
  key: string,
  retained: RetainedPartPaths,
  generated: ColoredPath,
): ColoredPath {
  const old = retained.settings.get(key);
  if (old !== undefined) {
    const { subpathNesting: _nesting, ...settings } = old;
    return {
      ...settings,
      polylines: generated.polylines,
      curves: generated.curves ?? generated.polylines.map(polylineToCurveSubpath),
    };
  }
  const family = key.startsWith('mount-') ? 'mount-' : 'hole-';
  const siblingKey = object.partGenerator.pathKeys.find((candidate) =>
    candidate.startsWith(family),
  );
  const sibling = siblingKey === undefined ? undefined : retained.settings.get(siblingKey);
  const operationIds = sibling?.operationIds ?? object.operationIds;
  return {
    ...generated,
    ...(sibling === undefined ? {} : { color: sibling.color }),
    ...(operationIds === undefined ? {} : { operationIds }),
  };
}
function retainTabs(
  tabs: readonly CncTabAnchor[],
  before: readonly string[],
  after: readonly string[],
): readonly CncTabAnchor[] {
  return tabs.flatMap((tab) => {
    const key = before[tab.pathIndex];
    const index = key === undefined ? -1 : after.indexOf(key);
    return index < 0 ? [] : [{ ...tab, pathIndex: index }];
  });
}
export function partGeneratorGeometryMatches(object: ImportedSvg): boolean {
  if (object.partGenerator === undefined) return true;
  const generated = materializePartGenerator(object.partGenerator.definition);
  return generated.kind === 'ok' && partGeometryMatches(object, generated.value);
}
function partGeometryMatches(object: ImportedSvg, geometry: PartGeneratorGeometry): boolean {
  if (
    object.paths.length !== geometry.paths.length ||
    !sameRecipeValue(object.bounds, geometry.bounds)
  )
    return false;
  return geometry.paths.every((path, index) => {
    const current = object.paths[index];
    return current !== undefined && samePartPathGeometry(path, current);
  });
}
export function bakePartGenerator(object: GeneratedPartObject): ImportedSvg {
  const { partGenerator: _intent, ...baked } = object;
  return baked;
}
