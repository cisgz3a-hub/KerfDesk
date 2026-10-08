import type { ArraySpec, Project, Scene, SceneGroup, SceneObject } from '../../core/scene';
import type { RetainedArrayInstance, RetainedArrayLayout } from '../../core/scene/retained-array';
import { deserializeProject, serializeProject } from '../../io/project';
import { sceneObjectCopyDependencyIds } from './scene-object-copy-dependencies';
import { groupsForObjectIds } from './prune-scene-groups';

export type RetainArrayRequest = {
  readonly name: string;
  readonly spec: ArraySpec;
  readonly evaluationTime?: string;
  readonly advanceVariables?: boolean;
};

export function arrayArchiveProject(project: Project, ids: ReadonlySet<string>): Project {
  const {
    sheetBook: _book,
    productionManifest: _manifest,
    arrayLayouts: _layouts,
    ...source
  } = project;
  return {
    ...source,
    jobSetup: {
      ...source.jobSetup,
      outputScope: { cutSelectedGraphics: false, useSelectionOrigin: false, selectedObjectIds: [] },
    },
    scene: {
      ...source.scene,
      objects: source.scene.objects.filter((object) => ids.has(object.id)),
      groups: arrayArchiveGroups(source.scene.groups ?? [], ids),
      ...(source.scene.artworkOrder === undefined
        ? {}
        : { artworkOrder: source.scene.artworkOrder.filter((id) => ids.has(id)) }),
    },
  };
}

export function arrayArchiveGroups(
  groups: readonly SceneGroup[],
  ids: ReadonlySet<string>,
): SceneGroup[] {
  return [...groupsForObjectIds(groups, ids)];
}

export function captureRetainedArray(input: {
  readonly project: Project;
  readonly scene: Scene;
  readonly sources: readonly SceneObject[];
  readonly selectedIds: ReadonlySet<string>;
  readonly instances: readonly ReadonlyMap<string, string>[];
  readonly request: RetainArrayRequest;
  readonly idFactory: () => string;
}): RetainedArrayLayout {
  const { project, sources, selectedIds, instances, request, idFactory } = input;
  const sourceIds = new Set(sources.map((object) => object.id));
  const memberIds = new Set(instances.flatMap((instance) => [...instance.values()]));
  const ownedObjectIds = retainedArrayOwnedObjectIds(project, sources, selectedIds, instances);
  const capturedInstances: RetainedArrayInstance[] = instances.map((map) => ({
    id: idFactory(),
    sourceToObject: Object.fromEntries(map),
  }));
  return {
    id: idFactory(),
    name: request.name.trim() || 'Array',
    spec: request.spec,
    sourceIds: [...selectedIds],
    instances: capturedInstances,
    ownedObjectIds,
    sourceProjectJson: serializeProject(arrayArchiveProject(project, sourceIds), { compact: true }),
    baselineProjectJson: serializeProject(
      arrayArchiveProject({ ...project, scene: input.scene }, memberIds),
      { compact: true },
    ),
    ...(request.evaluationTime === undefined ? {} : { evaluationTime: request.evaluationTime }),
    ...(request.advanceVariables === undefined
      ? {}
      : { advanceVariables: request.advanceVariables }),
  };
}

const changeCache = new WeakMap<Project, WeakMap<RetainedArrayLayout, boolean>>();

/** Geometry/operation/name edits and missing dependencies stay intact until explicit expansion. */
export function retainedArrayChanged(project: Project, layout: RetainedArrayLayout): boolean {
  let entries = changeCache.get(project);
  if (entries === undefined) {
    entries = new WeakMap();
    changeCache.set(project, entries);
  }
  const cached = entries.get(layout);
  if (cached !== undefined) return cached;
  const changed = changedFromBaseline(project, layout);
  entries.set(layout, changed);
  return changed;
}

function changedFromBaseline(project: Project, layout: RetainedArrayLayout): boolean {
  const loaded = deserializeProject(layout.baselineProjectJson);
  if (loaded.kind !== 'ok') return true;
  const ids = new Set(loaded.project.scene.objects.map((object) => object.id));
  return (
    arraySceneIdentity(arrayArchiveProject(project, ids)) !== arraySceneIdentity(loaded.project)
  );
}

export function arraySceneIdentity(project: Project): string {
  const scene = (JSON.parse(serializeProject(project, { compact: true })) as { scene: Scene })
    .scene;
  return JSON.stringify(
    sortedKeys({
      objects: scene.objects,
      groups: scene.groups ?? [],
      artworkOrder: scene.artworkOrder ?? [],
    }),
  );
}
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortedKeys(child)]),
  );
}

export function retainedArrayOwnedObjectIds(
  project: Project,
  sources: readonly SceneObject[],
  selectedIds: ReadonlySet<string>,
  instances: readonly ReadonlyMap<string, string>[],
): string[] {
  const sourceIds = new Set(sources.map((object) => object.id));
  const originalById = new Map(project.scene.objects.map((object) => [object.id, object]));
  const external = new Set(
    project.scene.objects
      .filter((object) => !sourceIds.has(object.id))
      .flatMap(sceneObjectCopyDependencyIds),
  );
  const memberIds = new Set(instances.flatMap((instance) => [...instance.values()]));
  return [...memberIds].filter(
    (id) =>
      !external.has(id) &&
      (!sourceIds.has(id) || selectedIds.has(id) || originalById.get(id)?.locked !== true),
  );
}
