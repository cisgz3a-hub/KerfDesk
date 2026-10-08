import type { Project, Scene, SceneObject } from '../../core/scene';
import type { ArrayFirstPlacementPlan } from './array-first-placement';
import {
  captureRetainedArray,
  retainedArrayOwnedObjectIds,
  type RetainArrayRequest,
} from './retained-array-capture';
import { fixedArrayScene } from './retained-array-values';
import { validateRetainedArrays } from '../../io/project/project-array-validator';
import { validateProjectShape } from '../../io/project/project-shape-validator';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';
import { useToastStore } from './toast-store';

export function retainedProject(
  project: Project,
  scene: Scene,
  sources: readonly SceneObject[],
  selectedIds: ReadonlySet<string>,
  first: ArrayFirstPlacementPlan,
  later: readonly ReadonlyMap<string, string>[],
  retain: RetainArrayRequest | undefined,
  idFactory: () => string,
): Project | null {
  if (retain === undefined) return checkedArchiveBudget({ ...project, scene });
  const firstMap = new Map(
    sources.map((object) => [object.id, first.copiedIds.get(object.id) ?? object.id]),
  );
  const instances = [firstMap, ...later];
  const owned = retainedArrayOwnedObjectIds(project, sources, selectedIds, instances);
  const fixedScene = fixedArrayScene(project, scene, new Set(owned), retain.evaluationTime);
  if (fixedScene === null) {
    useToastStore
      .getState()
      .pushToast('Prepare the variable values before retaining this array.', 'warning');
    return null;
  }
  const layout = captureRetainedArray({
    project,
    scene: fixedScene,
    sources,
    selectedIds,
    instances,
    request: retain,
    idFactory,
  });
  const arrayLayouts = [...(project.arrayLayouts ?? []), layout];
  const next = { ...project, scene: fixedScene, arrayLayouts };
  const error =
    visitWorkflowArchives(next) ?? validateRetainedArrays(arrayLayouts, validateProjectShape);
  if (error !== null) {
    useToastStore.getState().pushToast(error, 'warning');
    return null;
  }
  return next;
}
function checkedArchiveBudget(project: Project): Project | null {
  const error = visitWorkflowArchives(project);
  if (error === null) return project;
  useToastStore.getState().pushToast(error, 'warning');
  return null;
}
