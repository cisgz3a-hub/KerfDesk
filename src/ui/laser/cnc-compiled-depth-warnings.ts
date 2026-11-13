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
    // CNC audit v2 J1-P2-1: a flowing V-carve's depth follows stroke width, so
    // the default 1/2" 90° bit in default stock lands on the bottom; it warns
    // there as relief does.
    warnAtStockBottom: true,
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

// CNC audit v3 N2-P2-3: a floor left thinner than this holds nothing, so it
// warns as the stock bottom itself does (ADR-572 Amd 4 counts 0.1 mm as cut
// free; the X6 refuter put "effectively free" at 0.2 mm).
const THIN_FLOOR_MM = 0.2;

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
    // Both are output coordinates (0.001 mm), so compare the floor in microns.
    const floorMm = Math.round((representedStockMm - emittedDepthMm) * 1000) / 1000;
    if (floorMm >= 0) {
      if (copy.warnAtStockBottom !== true || floorMm >= THIN_FLOOR_MM - 1e-9) return [];
      const where =
        floorMm === 0
          ? 'reaches the configured stock bottom'
          : `leaves only ${formatText(floorMm.toFixed(3))} mm of stock under its floor`;
      return [
        `Layer ${layerId} ${where} at an actual compiled ${copy.label} depth of ` +
          `${formatText(emittedDepthText)} mm in ${formatText(representedStockText)} mm stock. ` +
          `${capitalised(copy.label)} paths have no holding tabs; if this geometry separates a part, ` +
          'confirm workholding and spoilboard clearance in Job Review.',
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

function capitalised(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatText(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
