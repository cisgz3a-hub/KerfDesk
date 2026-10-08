import type { CncLayerSettings, Layer, Project, SceneObject } from '../../core/scene';
import type {
  ReliefAuthoringDocument,
  ReliefVectorMask,
} from '../../core/scene/relief/relief-authoring';
import type { ReliefOpenRail } from '../../core/scene/relief/relief-rail-profile';
import {
  sceneObjectUsesOperation,
  remapSceneObjectOperationBindings,
  nextOperationColor,
} from '../../core/scene';

export function productionLinkedDependencyIds(
  project: Project,
  object: SceneObject,
): ReadonlyArray<string> {
  const relief = 'reliefAuthoring' in object ? object.reliefAuthoring : undefined;
  return [
    ...new Set([
      ...reliefDocumentIds(relief),
      ...project.scene.layers.flatMap((layer) =>
        layer.cnc?.reliefProjection !== undefined && sceneObjectUsesOperation(object, layer)
          ? [layer.cnc.reliefProjection.reliefObjectId]
          : [],
      ),
    ]),
  ];
}
function reliefDocumentIds(document: ReliefAuthoringDocument | undefined): ReadonlyArray<string> {
  if (document === undefined) return [];
  return [
    document.clip?.linkedObjectId,
    ...document.levels.map((level) => level.mask?.linkedObjectId),
    ...document.components.flatMap((component) => [
      component.mask?.linkedObjectId,
      ...reliefSourceIds(component.source),
    ]),
    ...document.strokes.map((stroke) => stroke.region?.linkedObjectId),
  ].flatMap((id) => id ?? []);
}
function reliefSourceIds(
  source: ReliefAuthoringDocument['components'][number]['source'],
): ReadonlyArray<string> {
  if (source.kind === 'vector-shape-v1')
    return source.boundary.linkedObjectId === undefined ? [] : [source.boundary.linkedObjectId];
  if (source.kind === 'rail-profile-v1')
    return [source.rail.linkedObjectId, source.secondRail?.linkedObjectId].flatMap(
      (id) => id ?? [],
    );
  return [];
}
export function remapProductionReliefLinks(
  object: SceneObject,
  ids: ReadonlyMap<string, string>,
): SceneObject {
  if (!('reliefAuthoring' in object) || object.reliefAuthoring === undefined) return object;
  const document = object.reliefAuthoring;
  const clip = remapMask(document.clip, ids);
  return {
    ...object,
    reliefAuthoring: {
      ...document,
      ...(clip === undefined ? {} : { clip }),
      levels: document.levels.map((level) => {
        const mask = remapMask(level.mask, ids);
        return mask === undefined ? level : { ...level, mask };
      }),
      components: document.components.map((component) => {
        const mask = remapMask(component.mask, ids);
        return {
          ...component,
          ...(mask === undefined ? {} : { mask }),
          source: remapReliefSource(component.source, ids),
        };
      }),
      strokes: document.strokes.map((stroke) => {
        const region = remapMask(stroke.region, ids);
        return region === undefined ? stroke : { ...stroke, region };
      }),
    },
  };
}
function remapMask(
  mask: ReliefVectorMask | undefined,
  ids: ReadonlyMap<string, string>,
): ReliefVectorMask | undefined {
  return mask?.linkedObjectId === undefined
    ? mask
    : { ...mask, linkedObjectId: ids.get(mask.linkedObjectId) ?? mask.linkedObjectId };
}
function remapRail(rail: ReliefOpenRail, ids: ReadonlyMap<string, string>): ReliefOpenRail {
  return rail.linkedObjectId === undefined
    ? rail
    : { ...rail, linkedObjectId: ids.get(rail.linkedObjectId) ?? rail.linkedObjectId };
}
function remapReliefSource(
  source: ReliefAuthoringDocument['components'][number]['source'],
  ids: ReadonlyMap<string, string>,
): ReliefAuthoringDocument['components'][number]['source'] {
  if (source.kind === 'vector-shape-v1')
    return { ...source, boundary: remapMask(source.boundary, ids) ?? source.boundary };
  if (source.kind === 'rail-profile-v1')
    return {
      ...source,
      rail: remapRail(source.rail, ids),
      ...(source.secondRail === undefined ? {} : { secondRail: remapRail(source.secondRail, ids) }),
    };
  return source;
}
export function copyProductionProjectionLayers(
  project: Project,
  objects: ReadonlyArray<SceneObject>,
  ids: ReadonlyMap<string, string>,
  prefix: string,
  existingColors: ReadonlyArray<Pick<Layer, 'color'>> = project.scene.layers,
): { readonly layers: ReadonlyArray<Layer>; readonly operationIds: ReadonlyMap<string, string> } {
  const operationIds = new Map<string, string>();
  const palette = [...existingColors];
  const layers = project.scene.layers.flatMap((layer, index) => {
    const settings = layer.cnc;
    const target = settings?.reliefProjection?.reliefObjectId;
    if (
      settings === undefined ||
      target === undefined ||
      !ids.has(target) ||
      !objects.some((object) => sceneObjectUsesOperation(object, layer))
    )
      return [];
    const id = prefix + '-projection-' + (index + 1);
    operationIds.set(layer.id, id);
    const color = nextOperationColor(palette);
    palette.push({ color });
    return [
      {
        ...layer,
        id,
        color,
        cnc: remapProductionProjection(settings, ids),
      },
    ];
  });
  return { layers, operationIds };
}
export function remapProductionProjection(
  settings: CncLayerSettings,
  ids: ReadonlyMap<string, string>,
): CncLayerSettings {
  if (settings.reliefProjection === undefined) return settings;
  return {
    ...settings,
    reliefProjection: {
      ...settings.reliefProjection,
      reliefObjectId:
        ids.get(settings.reliefProjection.reliefObjectId) ??
        settings.reliefProjection.reliefObjectId,
    },
  };
}
export function remapProductionOperationBindings(
  object: SceneObject,
  layers: ReadonlyArray<Layer>,
  operations: ReadonlyMap<string, string>,
): SceneObject {
  if (operations.size === 0) return object;
  const identity = new Map(layers.map((layer) => [layer.id, layer.id]));
  const carried = [
    ...(object.operationIds ?? []),
    ...('paths' in object ? object.paths.flatMap((path) => path.operationIds ?? []) : []),
    ...Object.keys(object.operationOverride?.byOperation ?? {}),
  ];
  carried.forEach((id) => identity.set(id, id));
  operations.forEach((id, source) => identity.set(source, id));
  return remapSceneObjectOperationBindings(object, layers, identity);
}
export function remapProductionSetup(
  project: Project,
  copies: ReadonlyArray<ReadonlyMap<string, string>>,
): Project['cncSetup'] {
  const setup = project.cncSetup;
  if (setup?.twoSided === undefined) return setup;
  const mapped = (ids: ReadonlyArray<string>): string[] => [
    ...new Set(copies.flatMap((copy) => ids.flatMap((id) => copy.get(id) ?? []))),
  ];
  return {
    ...setup,
    twoSided: {
      ...setup.twoSided,
      sideAObjectIds: mapped(setup.twoSided.sideAObjectIds),
      sideBObjectIds: mapped(setup.twoSided.sideBObjectIds),
    },
  };
}
