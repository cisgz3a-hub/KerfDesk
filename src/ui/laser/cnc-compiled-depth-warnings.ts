import type { CncGroup, Job } from '../../core/job';
import { cncGroupMaximumDepthMm } from '../../core/job/job';
import type { Project } from '../../core/scene';

type CompiledLayerDepth = {
  readonly layerId: string;
  readonly depthMm: number;
};

/** Greatest actual compiled V-carve depth for one operation layer. */
export type CompiledVCarveLayerDepth = CompiledLayerDepth;

/** Greatest actual compiled relief depth for one operation layer. */
export type CompiledReliefLayerDepth = CompiledLayerDepth;

/** Aggregate the deepest compiled V-carve motion for every contributing layer. */
export function compiledVCarveLayerDepths(job: Job): ReadonlyArray<CompiledVCarveLayerDepth> {
  return compiledLayerDepths(job, (cutType) => cutType === 'v-carve');
}

/** Aggregate the deepest compiled roughing or finishing relief motion for every layer. */
export function compiledReliefLayerDepths(job: Job): ReadonlyArray<CompiledReliefLayerDepth> {
  return compiledLayerDepths(
    job,
    (cutType) => cutType === 'relief-rough' || cutType === 'relief-finish',
  );
}

/** Build advisory text when compiled V-carve motion extends below configured stock. */
export function detectCompiledVCarveDepthWarnings(
  depths: ReadonlyArray<CompiledVCarveLayerDepth>,
  stockThicknessMm: number,
): ReadonlyArray<string> {
  return detectDepthWarnings(depths, stockThicknessMm, {
    label: 'V-carve',
    remediation:
      'Change the artwork, bit geometry, or enable a flat depth if that is not intended.',
  });
}

/** Build configured-stock V-carve depth advisories from a compiled CNC job. */
export function detectCompiledVCarveDepthWarningsForJob(
  project: Project,
  job: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  return machine?.kind === 'cnc'
    ? detectCompiledVCarveDepthWarnings(compiledVCarveLayerDepths(job), machine.stock.thicknessMm)
    : [];
}

/** Build advisory text when compiled relief motion extends below configured stock. */
export function detectCompiledReliefDepthWarnings(
  depths: ReadonlyArray<CompiledReliefLayerDepth>,
  stockThicknessMm: number,
): ReadonlyArray<string> {
  return detectDepthWarnings(depths, stockThicknessMm, {
    label: 'relief',
    remediation: 'Reduce the relief depth or use thicker stock if that is not intended.',
    warnAtStockBottom: true,
  });
}

/** Build configured-stock relief depth advisories from a compiled CNC job. */
export function detectCompiledReliefDepthWarningsForJob(
  project: Project,
  job: Job,
): ReadonlyArray<string> {
  const machine = project.machine;
  return machine?.kind === 'cnc'
    ? detectCompiledReliefDepthWarnings(compiledReliefLayerDepths(job), machine.stock.thicknessMm)
    : [];
}

function compiledLayerDepths(
  job: Job,
  matchesCutType: (cutType: CncGroup['cutType']) => boolean,
): ReadonlyArray<CompiledLayerDepth> {
  const byLayer = new Map<string, number>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || !matchesCutType(group.cutType)) continue;
    byLayer.set(
      group.layerId,
      Math.max(byLayer.get(group.layerId) ?? 0, cncGroupMaximumDepthMm(group)),
    );
  }
  return [...byLayer].map(([layerId, depthMm]) => ({ layerId, depthMm }));
}

type DepthWarningCopy = {
  readonly label: string;
  readonly remediation: string;
  readonly warnAtStockBottom?: boolean;
};

function detectDepthWarnings(
  depths: ReadonlyArray<CompiledLayerDepth>,
  stockThicknessMm: number,
  copy: DepthWarningCopy,
): ReadonlyArray<string> {
  if (!(stockThicknessMm >= 0) || !Number.isFinite(stockThicknessMm)) return [];
  return depths.flatMap(({ layerId, depthMm }) => {
    if (
      !(depthMm > stockThicknessMm) &&
      !(copy.warnAtStockBottom && depthMm === stockThicknessMm)
    ) {
      return [];
    }
    if (depthMm === stockThicknessMm) {
      return [
        `Layer ${layerId} reaches the configured stock bottom at an actual compiled ${copy.label} ` +
          `depth of ${format(depthMm)} mm. Relief paths have no holding tabs; if this geometry ` +
          'separates a part, confirm workholding and spoilboard clearance in Job Review.',
      ];
    }
    const pastMm = depthMm - stockThicknessMm;
    return [
      `Layer ${layerId} reaches an actual compiled ${copy.label} depth of ${format(depthMm)} mm ` +
        `in ${format(stockThicknessMm)} mm stock — ${pastMm.toFixed(2)} mm past the bottom, ` +
        `into the spoilboard. ${copy.remediation}`,
    ];
  });
}

function format(value: number): string {
  return Number(value.toFixed(3)).toString();
}
