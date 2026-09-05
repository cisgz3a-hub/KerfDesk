import {
  analyzeFillHeatRisk,
  compileJob,
  type FillHeatRiskSummary,
  type Job,
} from '../../core/job';
import type { Layer, Project } from '../../core/scene';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';

export type MachineSetupFillHeatRisk = FillHeatRiskSummary | 'no-island' | 'background';

export function machineSetupFillHeatRisk(
  project: Project,
  fillLayers: readonly Layer[],
  compiledJob?: Job | null,
): MachineSetupFillHeatRisk {
  if (!fillLayers.some((layer) => layer.fillStyle === 'island')) return 'no-island';
  if (compiledJob === null || (compiledJob === undefined && costlyCanvasPreparation(project))) {
    return 'background';
  }
  return analyzeFillHeatRisk(
    compiledJob ?? compileJob(project.scene, project.device),
    project.device.scanningOffsets,
  );
}

export function machineSetupFillHeatRiskWarning(
  fillHeatRisk: MachineSetupFillHeatRisk,
): string | null {
  if (fillHeatRisk === 'background') {
    return 'Detailed Island Fill sweep analysis runs in the background for this canvas. Review the exact result in Job Review before running the job.';
  }
  if (fillHeatRisk === 'no-island') return null;
  if (fillHeatRisk.islandNoRunwayShortSweepCount > 0) {
    return `Island Fill has ${fillHeatRisk.islandNoRunwayShortSweepCount} short sweep(s) with no acceleration runway. Increase fill overscan or use Scanline Fill if those small islands look darker than the rest.`;
  }
  if (fillHeatRisk.islandPartialRunwaySweepCount > 0) {
    return `Island Fill has ${fillHeatRisk.islandPartialRunwaySweepCount} short sweep(s) that need partial acceleration runway. KerfDesk will add capped laser-off runway, but test on scrap if those small islands look darker than the rest.`;
  }
  return null;
}
