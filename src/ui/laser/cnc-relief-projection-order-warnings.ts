import type { Job } from '../../core/job';
import type { CncGroup } from '../../core/job/job';
import type { Project } from '../../core/scene/project';

/** Compare the final executable order with exact retained target IDs, never filenames. */
export function reliefProjectionOrderWarnings(
  project: Project,
  job: Job | undefined,
): readonly string[] {
  const plans = job?.cncCompilation?.reliefPlans ?? [];
  const groups = job?.groups ?? [];
  const warnings: string[] = [];
  for (const plan of plans) {
    if (plan.stage !== 'projection' || plan.targetObjectId === undefined) continue;
    const firstProjection = groups.findIndex(
      (group) => group.kind === 'cnc' && group.layerId === plan.layerId,
    );
    if (firstProjection < 0) continue;
    const targetLayers = new Set(
      plans
        .filter(
          (candidate) =>
            candidate.stage !== 'projection' && candidate.targetObjectId === plan.targetObjectId,
        )
        .map((candidate) => candidate.layerId),
    );
    const laterLayers = new Set(
      groups
        .slice(firstProjection + 1)
        .filter(isReliefGroup)
        .filter((group) => targetLayers.has(group.layerId))
        .map((group) => group.layerId),
    );
    if (laterLayers.size === 0) continue;
    const names = [...laterLayers].map((id) => '"' + layerName(project, id) + '"').join(', ');
    warnings.push(
      'Projection on layer "' +
        layerName(project, plan.layerId) +
        '" runs before later relief machining on layer ' +
        names +
        ' for target "' +
        plan.source +
        '". ' +
        'This output order does not establish the named surface before projection. Prepare that surface first or change the operation/tool order, and review the 3D preview.',
    );
  }
  return warnings;
}
function isReliefGroup(group: Job['groups'][number]): group is CncGroup {
  return (
    group.kind === 'cnc' && (group.cutType === 'relief-rough' || group.cutType === 'relief-finish')
  );
}
function layerName(project: Project, id: string): string {
  return project.scene.layers.find((layer) => layer.id === id)?.name ?? id;
}
