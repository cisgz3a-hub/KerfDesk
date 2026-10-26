import type { Project, SceneGroup } from '../../core/scene';
import type { RetainedArrayLayout } from '../../core/scene/retained-array';
import { deserializeProject } from '../../io/project';
import { promoteGroupParents } from './prune-scene-groups';

/** Old captures trimmed partial parents. Actual initial instance groups retain
 * the grouping intent without treating an archived trimmed parent as complete. */
export function retainedArrayReplaySource(source: Project, layout: RetainedArrayLayout): Project {
  const loaded = deserializeProject(layout.baselineProjectJson);
  if (loaded.kind !== 'ok') return source;
  const owned = new Set(layout.ownedObjectIds);
  const instance =
    layout.instances.find((entry) =>
      Object.values(entry.sourceToObject).every((id) => owned.has(id)),
    ) ?? layout.instances[0];
  if (instance === undefined) return source;
  const inverse = new Map(
    Object.entries(instance.sourceToObject).map(([sourceId, objectId]) => [objectId, sourceId]),
  );
  const originals = loaded.project.scene.groups ?? [];
  const complete = originals.filter((group) => group.objectIds.every((id) => inverse.has(id)));
  const groups: SceneGroup[] = promoteGroupParents(
    complete,
    new Map(originals.map((group) => [group.id, group])),
  ).map((group) => ({
    ...group,
    objectIds: group.objectIds.map((id) => inverse.get(id) as string),
  }));
  return { ...source, scene: { ...source.scene, groups } };
}
