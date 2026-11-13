import type { Job } from '../job';
import type { CncMachineConfig } from '../scene';
import type { CncCuttingStage } from '../scene/cnc-stage-recipe';

export type CncStageRecipeRuns = (
  layerId: string,
  stage: CncCuttingStage,
  toolId: string,
) => boolean;

// A layer keeps a recipe its cut type no longer uses (ADR-481), and the
// compiler applies one only to a stage cut with the recipe's cutter. With the
// compiled job, a recipe counts where a group of its layer ran that stage.
// Without one, a recipe counts when its cutter is in the tool library, since a
// recipe for an absent cutter cannot emit.
export function cncStageRecipeRuns(
  machine: CncMachineConfig | undefined,
  job: Job | undefined,
): CncStageRecipeRuns {
  if (job === undefined) {
    const toolIds = new Set(machine?.tools.map((tool) => tool.id) ?? []);
    return (_layerId, _stage, toolId) => toolIds.has(toolId);
  }
  const ran = new Map<string, Set<CncCuttingStage>>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.cuttingStage === undefined) continue;
    const stages = ran.get(group.layerId) ?? new Set<CncCuttingStage>();
    stages.add(group.cuttingStage);
    ran.set(group.layerId, stages);
  }
  return (layerId, stage) => ran.get(layerId)?.has(stage) === true;
}
