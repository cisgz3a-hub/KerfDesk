import { cncPreparationInputs } from '../../core/cnc/cnc-preparation-dependencies';
import type { Job } from '../../core/job/job';
import type { Project } from '../../core/scene/project';
import type { CncTool } from '../../core/scene/cnc-tool';

type CncOperationGroup = Extract<Job['groups'][number], { kind: 'cnc' }>;
export type CncProgramOperation = {
  readonly operationId: string;
  readonly name: string;
  readonly cutType: string;
  readonly toolId: string | null;
  readonly toolName: string | null;
  readonly toolDiameterMm: number;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly safeZMm: number;
  readonly passCount: number;
  readonly pairedInlay?: CncOperationGroup['pairedInlay'];
  readonly requestedDepthMm?: number;
  readonly restStock?: CncOperationGroup['restStock'];
};
export type CncProgramFacts = {
  readonly operations: ReadonlyArray<CncProgramOperation>;
  readonly toolPlan: ReadonlyArray<{ readonly id: string | null; readonly name: string | null }>;
  readonly tools: ReadonlyArray<CncTool>;
  readonly sourceSha256?: string;
};

/** Take resolved values from the prepared job, after scope, overrides and tool-section ordering. */
export function cncProgramFacts(job: Job, project: Project): CncProgramFacts {
  const operations: CncProgramOperation[] = [],
    toolPlan: CncProgramFacts['toolPlan'][number][] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const id = group.toolId ?? null;
    if (toolPlan.length === 0 || toolPlan.at(-1)?.id !== id)
      toolPlan.push({ id, name: group.toolName ?? null });
    operations.push(operationFacts(group, project));
  }
  return {
    operations,
    toolPlan,
    tools: resolvedTools(project, toolPlan).map((tool) => ({ ...tool })),
    sourceSha256: 'sha256:' + cncPreparationInputs(project).signature,
  };
}

function operationFacts(group: CncOperationGroup, project: Project): CncProgramOperation {
  return {
    operationId: group.layerId,
    name: project.scene.layers.find((layer) => layer.id === group.layerId)?.name ?? group.layerId,
    cutType: group.cutType,
    toolId: group.toolId ?? null,
    toolName: group.toolName ?? null,
    toolDiameterMm: group.toolDiameterMm,
    feedMmPerMin: group.feedMmPerMin,
    plungeMmPerMin: group.plungeMmPerMin,
    spindleRpm: group.spindleRpm,
    safeZMm: group.safeZMm,
    passCount: group.passes.length,
    ...(group.pairedInlay === undefined ? {} : { pairedInlay: group.pairedInlay }),
    ...(group.restStock === undefined ? {} : { restStock: group.restStock }),
    ...(group.requestedDepthMm === undefined ? {} : { requestedDepthMm: group.requestedDepthMm }),
  };
}
function resolvedTools(
  project: Project,
  toolPlan: CncProgramFacts['toolPlan'],
): ReadonlyArray<CncTool> {
  const machine = project.machine;
  return machine?.kind === 'cnc'
    ? machine.tools.filter((tool) =>
        toolPlan.some((entry) => (entry.id ?? machine.toolId) === tool.id),
      )
    : [];
}
