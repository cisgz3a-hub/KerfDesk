import type { Job } from '../../core/job';
import { cncGroupMaximumDepthMm } from '../../core/job/job';
import type { Project } from '../../core/scene';

export type CompiledVCarveLayerDepth = {
  readonly layerId: string;
  readonly depthMm: number;
};

export function compiledVCarveLayerDepths(job: Job): ReadonlyArray<CompiledVCarveLayerDepth> {
  const byLayer = new Map<string, number>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.cutType !== 'v-carve') continue;
    byLayer.set(
      group.layerId,
      Math.max(byLayer.get(group.layerId) ?? 0, cncGroupMaximumDepthMm(group)),
    );
  }
  return [...byLayer].map(([layerId, depthMm]) => ({ layerId, depthMm }));
}

export function detectCompiledVCarveDepthWarnings(
  depths: ReadonlyArray<CompiledVCarveLayerDepth>,
  stockThicknessMm: number,
): ReadonlyArray<string> {
  if (!(stockThicknessMm >= 0) || !Number.isFinite(stockThicknessMm)) return [];
  return depths.flatMap(({ layerId, depthMm }) => {
    if (!(depthMm > stockThicknessMm)) return [];
    const pastMm = depthMm - stockThicknessMm;
    return [
      `Layer ${layerId} reaches an actual compiled V-carve depth of ${format(depthMm)} mm ` +
        `in ${format(stockThicknessMm)} mm stock — ${pastMm.toFixed(2)} mm past the bottom, ` +
        'into the spoilboard. Change the artwork, bit geometry, or enable a flat depth if that is not intended.',
    ];
  });
}

export function detectCompiledVCarveDepthWarningsForJob(
  project: Project,
  job: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  return machine?.kind === 'cnc'
    ? detectCompiledVCarveDepthWarnings(compiledVCarveLayerDepths(job), machine.stock.thicknessMm)
    : [];
}

function format(value: number): string {
  return Number(value.toFixed(3)).toString();
}
