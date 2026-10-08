import { artworkOperationRuns } from '../../core/artwork-order';
import type { Project } from '../../core/scene/project';
import type { Scene } from '../../core/scene/scene';
import type { HeightfieldReliefObject, SceneObject } from '../../core/scene/scene-object';
import { sceneObjectUsesOperation } from '../../core/scene/operation-binding';
import { refreshReliefVectorLinks } from '../../core/relief/relief-authoring-links';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../../core/relief/relief-materialization-failure';

type PreparedRelief =
  | { readonly kind: 'ok'; readonly relief: HeightfieldReliefObject }
  | ReliefMaterializationFailure;

/** Resolve links against the full document even when only the relief is selected for output. */
export function prepareReliefAuthoringLinks(
  project: Project,
  scopedScene: Scene,
): { readonly kind: 'ok'; readonly scene: Scene } | ReliefMaterializationFailure {
  if (project.machine?.kind !== 'cnc') return { kind: 'ok', scene: scopedScene };
  const projectedIds = projectedReliefIds(scopedScene);
  const dependencies = projectionDependencies(project, scopedScene, projectedIds);
  const objects = [...scopedScene.objects, ...dependencies];
  let changed = false;
  for (const [index, object] of objects.entries()) {
    if (!usedAuthoringRelief(object, scopedScene, projectedIds)) continue;
    const prepared = prepareLinkedRelief(object, project);
    if (prepared.kind !== 'ok') return prepared;
    objects[index] = prepared.relief;
    changed ||= prepared.relief !== object;
  }
  return {
    kind: 'ok',
    scene:
      changed || dependencies.length !== (scopedScene.outputDependencies?.length ?? 0)
        ? {
            ...scopedScene,
            objects: objects.slice(0, scopedScene.objects.length),
            outputDependencies: objects.slice(scopedScene.objects.length),
          }
        : scopedScene,
  };
}

function projectedReliefIds(scene: Scene): ReadonlySet<string> {
  return new Set(
    artworkOperationRuns(scene).flatMap(({ layer }) =>
      layer.cnc?.reliefProjection === undefined ? [] : [layer.cnc.reliefProjection.reliefObjectId],
    ),
  );
}
function projectionDependencies(
  project: Project,
  scopedScene: Scene,
  projectedIds: ReadonlySet<string>,
): SceneObject[] {
  const dependencies = [...(scopedScene.outputDependencies ?? [])];
  const available = new Set([...scopedScene.objects, ...dependencies].map((object) => object.id));
  for (const object of project.scene.objects) {
    if (!projectedIds.has(object.id) || available.has(object.id)) continue;
    dependencies.push(object);
    available.add(object.id);
  }
  return dependencies;
}
function usedAuthoringRelief(
  object: SceneObject,
  scene: Scene,
  projectedIds: ReadonlySet<string>,
): object is HeightfieldReliefObject {
  if (object.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') return false;
  const relief = object as HeightfieldReliefObject;
  return (
    relief.reliefAuthoring !== undefined &&
    (projectedIds.has(relief.id) ||
      scene.layers.some((layer) => layer.output && sceneObjectUsesOperation(relief, layer)))
  );
}
function prepareLinkedRelief(relief: HeightfieldReliefObject, project: Project): PreparedRelief {
  const document = relief.reliefAuthoring;
  if (document === undefined) return { kind: 'ok', relief };
  const refreshed = refreshReliefVectorLinks(document, project.scene.objects, relief.transform);
  if (refreshed.kind === 'error')
    return reliefMaterializationFailure(relief.source, refreshed.reason);
  if (!refreshed.changed && document.revision === relief.reliefSource.revision)
    return { kind: 'ok', relief };
  const materialized = materializeReliefAuthoring(refreshed.document);
  if (materialized.kind !== 'ok')
    return reliefMaterializationFailure(
      relief.source,
      materialized.kind === 'error' ? materialized.reason : 'Composition cancelled.',
    );
  return {
    kind: 'ok',
    relief: { ...relief, reliefAuthoring: refreshed.document, reliefSource: materialized.field },
  };
}
