// What the recovery copy a refused Save offers will hold (ADR-307 Amendment 5).
//
// The raw copy wrote the in-memory project as it was, so a project refused
// for an object whose coordinates are past the loader's limit gave a copy that
// the loader refused on reopen too (rolling audit v11 W5-P2-1, after 13-P2-1).
// Such an object can never be stored, so the copy leaves it out, exactly as
// deleting it would (groups, masks, path-text guides and empty layers are
// repaired the same way), and the prompt and toast name what was left out.

import { removeObject, type Project } from '../../core/scene';
import {
  sceneObjectCoordinatesInRange,
  sceneObjectLabel,
} from '../../io/project/refused-scene-object';
import { repairDanglingObjectDependencies } from '../state/repair-object-dependencies';
import { removeObjectIdsFromGroups } from '../state/scene-group-actions';
import { pruneOrphanLayers } from '../state/scene-mutations';

export type RecoveryCopyPlan = {
  readonly project: Project;
  /** Labels of the objects the copy leaves out; empty for a raw copy. */
  readonly leftOut: ReadonlyArray<string>;
};

export function planRecoveryCopy(project: Project): RecoveryCopyPlan {
  const refused = project.scene.objects.flatMap((object, index) =>
    sceneObjectCoordinatesInRange(object)
      ? []
      : [{ id: object.id, label: sceneObjectLabel(object, index) }],
  );
  if (refused.length === 0) return { project, leftOut: [] };
  const ids = new Set(refused.map((entry) => entry.id));
  let scene = project.scene;
  for (const id of ids) scene = removeObject(scene, id);
  scene = pruneOrphanLayers(
    repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, ids)).scene,
  );
  return { project: { ...project, scene }, leftOut: refused.map((entry) => entry.label) };
}
