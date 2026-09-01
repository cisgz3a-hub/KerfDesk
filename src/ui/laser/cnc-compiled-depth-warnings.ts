import type { CncGroup, Job } from '../../core/job';
import {
  formatCncCoordinateMm,
  parseGrblCncCoordinate,
} from '../../core/cnc/coordinate-representation';
import { cncGroupMaximumDepth } from '../../core/cnc/output-representation';
import type { Project } from '../../core/scene';

type CompiledLayerDepth = {
  readonly layerId: string;
  readonly depthMm: number;
  /** Exact positive depth text from the deepest emitted negative-Z word. */
  readonly depthText?: string;
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
  const byLayer = new Map<string, CompiledLayerDepth>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || !matchesCutType(group.cutType)) continue;
    const depth = cncGroupMaximumDepth(group);
    const current = byLayer.get(group.layerId);
    if (current === undefined || depth.value > current.depthMm) {
      byLayer.set(group.layerId, {
        layerId: group.layerId,
        depthMm: depth.value,
        depthText: depth.text,
      });
    }
  }
  return [...byLayer.values()];
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
  return depths.flatMap(({ layerId, depthMm, depthText }) => {
    const emittedDepthText = depthText ?? formatCncCoordinateMm(depthMm);
    const representedStockText = formatCncCoordinateMm(stockThicknessMm);
    const emittedDepthMm = parseGrblCncCoordinate(emittedDepthText);
    const representedStockMm = parseGrblCncCoordinate(representedStockText);
    if (
      !(emittedDepthMm > representedStockMm) &&
      !(copy.warnAtStockBottom && emittedDepthMm === representedStockMm)
    ) {
      return [];
    }
    if (emittedDepthMm === representedStockMm) {
      return [
        `Layer ${layerId} reaches the configured stock bottom at an actual compiled ${copy.label} ` +
          `depth of ${formatText(emittedDepthText)} mm. Relief paths have no holding tabs; if this geometry ` +
          'separates a part, confirm workholding and spoilboard clearance in Job Review.',
      ];
    }
    const pastMm = emittedDepthMm - representedStockMm;
    return [
      `Layer ${layerId} reaches an actual compiled ${copy.label} depth of ${formatText(emittedDepthText)} mm ` +
        `in ${formatText(representedStockText)} mm stock — ${pastMm.toFixed(2)} mm past the bottom, ` +
        `into the spoilboard. ${copy.remediation}`,
    ];
  });
}

function formatText(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
