import type { AppState } from './store';
import type { Project } from '../../core/scene/project';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { refreshReliefVectorLinks } from '../../core/relief/relief-authoring-links';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';

type Patch = AppState | Partial<AppState>;
type Setter = (patch: Patch | ((state: AppState) => Patch)) => void;

/** Refresh linked intent in the originating edit's undo step, before subscribers prepare output. */
export function reliefLinkMutationSetter(rawSet: Setter): Setter {
  return (update) =>
    rawSet((state) => {
      const patch = typeof update === 'function' ? update(state) : update;
      if (
        patch.project === undefined ||
        patch.project === state.project ||
        (patch.projectDocumentEpoch !== undefined &&
          patch.projectDocumentEpoch !== state.projectDocumentEpoch)
      )
        return patch;
      const project = projectWithRefreshedReliefLinks(patch.project);
      return project === patch.project ? patch : { ...patch, project };
    });
}

export function projectWithRefreshedReliefLinks(project: Project): Project {
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    if (object.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') return object;
    const relief = object as HeightfieldReliefObject;
    if (relief.reliefAuthoring === undefined) return relief;
    const refreshed = refreshReliefVectorLinks(
      relief.reliefAuthoring,
      project.scene.objects,
      relief.transform,
    );
    // Missing/invalid links stay visible for repair. Output preparation discloses
    // them as an unresolvable source, rather than silently using an old field.
    if (refreshed.kind === 'error' || !refreshed.changed) return relief;
    const materialized = materializeReliefAuthoring(refreshed.document);
    if (materialized.kind !== 'ok') return relief;
    changed = true;
    return { ...relief, reliefAuthoring: refreshed.document, reliefSource: materialized.field };
  });
  return changed ? { ...project, scene: { ...project.scene, objects } } : project;
}
