import type { ArraySpec, Project, Scene, SceneObject } from '../../core/scene';
import type { RetainedArrayLayout } from '../../core/scene/retained-array';
import { deserializeProject, serializeProject } from '../../io/project';
import { applyArraySelection, type ArrayMaterialization } from './array-actions';
import { arrayArchiveProject, retainedArrayChanged } from './retained-array-capture';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyDependencyIds,
} from './scene-object-copy-dependencies';
import { sceneLimitOverrun } from './scene-copy-room';
import type { AppState } from './store';

export type ArrayRegeneration =
  | { readonly ok: true; readonly project: Project; readonly selectedIds: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const sourceCache = new WeakMap<RetainedArrayLayout, Project | null>();

export function retainedArraySource(
  _project: Project,
  layout: RetainedArrayLayout,
): Project | null {
  const cached = sourceCache.get(layout);
  if (cached !== undefined) return cached;
  const loaded = deserializeProject(layout.sourceProjectJson);
  const project = loaded.kind === 'ok' ? loaded.project : null;
  sourceCache.set(layout, project);
  return project;
}

export function regenerateRetainedArray(
  state: AppState,
  layout: RetainedArrayLayout,
  spec: ArraySpec,
  materialized?: ArrayMaterialization,
  idFactory: () => string = () => crypto.randomUUID(),
): ArrayRegeneration {
  if (retainedArrayChanged(state.project, layout))
    return {
      ok: false,
      reason:
        'An instance or dependency was edited or deleted. Expand to independent copies to preserve those overrides.',
    };
  const source = retainedArraySource(state.project, layout);
  if (source === null) return { ok: false, reason: 'The retained source cannot be reopened.' };
  const temporary = applyArraySelection(
    {
      ...state,
      project: source,
      selectedObjectId: layout.sourceIds[0] ?? null,
      additionalSelectedIds: new Set(layout.sourceIds.slice(1)),
    },
    spec,
    idFactory,
    materialized,
    retentionForLayout(layout),
  );
  const generated = temporary.project?.arrayLayouts?.[0];
  if (temporary.project === undefined || generated === undefined)
    return { ok: false, reason: 'The array cannot fit in the project object budget.' };
  const mapping = restoredObjectIds(layout, generated, idFactory);
  const objects = temporary.project.scene.objects.map((object) =>
    remapGeneratedObject(object, mapping),
  );
  const merged = mergeRegeneratedScene(
    state.project.scene,
    temporary.project.scene,
    objects,
    layout,
    mapping,
    idFactory,
  );
  if (!merged.ok) return merged;
  const scene = merged.scene;
  const budget = sceneLimitOverrun(state.project.scene, scene);
  if (budget !== null) return { ok: false, reason: budget };
  const next = restoredLayout(state.project, scene, layout, generated, mapping);
  return {
    ok: true,
    project: {
      ...state.project,
      scene,
      arrayLayouts: (state.project.arrayLayouts ?? []).map((entry) =>
        entry.id === layout.id ? next : entry,
      ),
    },
    selectedIds: generated.instances.flatMap((instance) =>
      layout.sourceIds.flatMap((id) => {
        const member = instance.sourceToObject[id];
        return member === undefined ? [] : [mapping.get(member) ?? member];
      }),
    ),
  };
}

type MergedScene =
  | { readonly ok: true; readonly scene: Scene }
  | Extract<ArrayRegeneration, { readonly ok: false }>;
function mergeRegeneratedScene(
  original: Scene,
  generated: Scene,
  objects: ReadonlyArray<SceneObject>,
  layout: RetainedArrayLayout,
  mapping: ReadonlyMap<string, string>,
  idFactory: () => string,
): MergedScene {
  const owned = new Set(layout.ownedObjectIds);
  const retained = original.objects.filter((object) => !owned.has(object.id));
  if (retained.some((object) => sceneObjectCopyDependencyIds(object).some((id) => owned.has(id))))
    return {
      ok: false,
      reason:
        'Other artwork now references an array member. Expand before changing its membership.',
    };
  if (
    (original.groups ?? []).some(
      (group) =>
        group.objectIds.some((id) => owned.has(id)) && group.objectIds.some((id) => !owned.has(id)),
    )
  )
    return {
      ok: false,
      reason:
        'An array member now shares a design group with other artwork. Expand to preserve that hierarchy.',
    };
  const groups = (original.groups ?? []).filter(
    (group) => !group.objectIds.some((id) => owned.has(id)),
  );
  const newGroups = regeneratedGroups(generated.groups ?? [], groups, mapping, idFactory);
  const merged = mergeRegeneratedObjects(original.objects, objects, owned);
  const scene = {
    ...original,
    objects: merged,
    groups: [...groups, ...newGroups],
    ...(original.artworkOrder === undefined
      ? {}
      : {
          artworkOrder: mergeRegeneratedOrder(
            original.artworkOrder,
            objects.map((object) => object.id),
            owned,
          ),
        }),
  };
  return { ok: true, scene };
}

function regeneratedGroups(
  generated: NonNullable<Scene['groups']>,
  kept: NonNullable<Scene['groups']>,
  objectMapping: ReadonlyMap<string, string>,
  idFactory: () => string,
): NonNullable<Scene['groups']> {
  const reserved = new Set(kept.map((group) => group.id));
  const ids = new Map(
    generated.map((group) => [group.id, reserved.has(group.id) ? idFactory() : group.id]),
  );
  return generated.map((group) => ({
    ...group,
    id: ids.get(group.id) ?? group.id,
    ...(group.parentId === undefined
      ? {}
      : { parentId: ids.get(group.parentId) ?? group.parentId }),
    objectIds: group.objectIds.map((id) => objectMapping.get(id) ?? id),
  }));
}

function mergeRegeneratedObjects(
  original: readonly SceneObject[],
  generated: readonly SceneObject[],
  owned: ReadonlySet<string>,
): SceneObject[] {
  const replacements = new Map(generated.map((object) => [object.id, object]));
  const oldIds = new Set(original.map((object) => object.id));
  const fresh = generated.filter((object) => !oldIds.has(object.id));
  const last = original.reduce(
    (found, object, index) => (owned.has(object.id) ? index : found),
    -1,
  );
  return original.flatMap((object, index) => {
    const replacement = replacements.get(object.id);
    const kept = owned.has(object.id) ? (replacement === undefined ? [] : [replacement]) : [object];
    return index === last ? [...kept, ...fresh] : kept;
  });
}
function mergeRegeneratedOrder(
  original: readonly string[],
  generated: readonly string[],
  owned: ReadonlySet<string>,
): string[] {
  const live = new Set(generated);
  const listed = new Set(original);
  const fresh = generated.filter((id) => !listed.has(id));
  const last = original.reduce((found, id, index) => (owned.has(id) ? index : found), -1);
  const result = original.flatMap((id, index) => [
    ...(!owned.has(id) || live.has(id) ? [id] : []),
    ...(index === last ? fresh : []),
  ]);
  return last === -1 ? [...result, ...fresh] : result;
}

function restoredObjectIds(
  previous: RetainedArrayLayout,
  generated: RetainedArrayLayout,
  idFactory: () => string,
): ReadonlyMap<string, string> {
  const owned = new Set(previous.ownedObjectIds);
  const mapping = new Map<string, string>();
  generated.instances.forEach((instance, index) =>
    Object.entries(instance.sourceToObject).forEach(([source, id]) => {
      const old = previous.instances[index]?.sourceToObject[source];
      mapping.set(id, old !== undefined && owned.has(old) ? old : idFactory());
    }),
  );
  return mapping;
}
function remapGeneratedObject(
  object: SceneObject,
  mapping: ReadonlyMap<string, string>,
): SceneObject {
  return remapSceneObjectCopyDependencies(
    { ...object, id: mapping.get(object.id) ?? object.id },
    mapping,
    { preserveSvgImport: true },
  );
}
function restoredLayout(
  project: Project,
  scene: Project['scene'],
  old: RetainedArrayLayout,
  generated: RetainedArrayLayout,
  mapping: ReadonlyMap<string, string>,
): RetainedArrayLayout {
  const instances = generated.instances.map((instance, index) => ({
    id: old.instances[index]?.id ?? instance.id,
    sourceToObject: Object.fromEntries(
      Object.entries(instance.sourceToObject).map(([source, id]) => [
        source,
        mapping.get(id) ?? id,
      ]),
    ),
  }));
  const ownedObjectIds = instances.flatMap((instance) => Object.values(instance.sourceToObject));
  return {
    ...generated,
    id: old.id,
    sourceProjectJson: old.sourceProjectJson,
    instances,
    ownedObjectIds,
    baselineProjectJson: serializeProject(
      arrayArchiveProject({ ...project, scene }, new Set(ownedObjectIds)),
      { compact: true },
    ),
  };
}

function retentionForLayout(layout: RetainedArrayLayout): {
  readonly name: string;
  readonly advanceVariables?: boolean;
} {
  return {
    name: layout.name,
    ...(layout.advanceVariables === undefined ? {} : { advanceVariables: layout.advanceVariables }),
  };
}
