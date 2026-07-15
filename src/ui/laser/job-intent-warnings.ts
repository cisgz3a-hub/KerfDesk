import { resolveGrblDialect, type GrblPowerMode } from '../../core/devices';
import {
  analyzeFillHeatRisk,
  compileJob,
  isSensitiveIslandFillPolicy,
  rasterBoundsInMachineCoords,
} from '../../core/job';
import { pixelExtentForMm } from '../../core/raster';
import {
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type LayerMode,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { detectUncalibratedJobWarnings } from './uncalibrated-job-warnings';

export function detectJobIntentWarnings(project: Project): ReadonlyArray<string> {
  const job = compileJob(project.scene, project.device);
  const warnings = [...detectUncalibratedJobWarnings(job)];
  appendFillHeatWarnings(job, warnings);

  const outputLayers = project.scene.layers.filter((layer) => layer.output);
  const seen = new Set<string>();

  for (const obj of project.scene.objects) {
    if (obj.kind === 'raster-image') {
      const upsample = rasterUpsampleWarning(obj, outputLayers, project);
      if (upsample !== null) warnings.push(upsample);
      continue;
    }
    if (obj.kind !== 'traced-image') continue;
    for (const path of obj.paths) {
      for (const layer of outputLayers) {
        if (!pathUsesOperation(obj, path, layer) || layer.mode === 'image') continue;
        const key = `${obj.id}:${layer.id}:${layer.mode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push(traceVectorWarning(obj.source, layer.mode, project));
      }
    }
  }

  return warnings;
}

function appendFillHeatWarnings(job: ReturnType<typeof compileJob>, warnings: string[]): void {
  const heat = analyzeFillHeatRisk(job);
  if (job.groups.some(isSensitiveIslandFillGroup) && heat.sensitiveIslandShortSweepCount > 0) {
    warnings.push(
      `4040-safe Island Fill has ${heat.sensitiveIslandShortSweepCount} short sweep(s) that can overburn or darken small details even with full laser-off runway. Use Scanline Fill for final 4040 burns until Island Fill is calibrated for this machine.`,
    );
  } else if (job.groups.some(isSensitiveIslandFillGroupWithOverscan)) {
    warnings.push(
      '4040-safe Island Fill is active. KerfDesk will use local clustered, unidirectional sweeps with full laser-off runway; this may run slower but is safer for sensitive motion.',
    );
  }
  if (heat.islandNoRunwayShortSweepCount > 0) {
    warnings.push(
      `Island Fill has ${heat.islandNoRunwayShortSweepCount} short sweep(s) with no acceleration runway. Increase fill overscan or use Scanline Fill if those small islands look darker than the rest.`,
    );
    return;
  }
  if (heat.islandPartialRunwaySweepCount > 0) {
    warnings.push(
      `Island Fill has ${heat.islandPartialRunwaySweepCount} short sweep(s) that need partial acceleration runway. KerfDesk will add capped laser-off runway, but test on scrap if those small islands look darker than the rest.`,
    );
  }
}

function isSensitiveIslandFillGroup(
  group: ReturnType<typeof compileJob>['groups'][number],
): boolean {
  return (
    group.kind === 'fill' &&
    group.fillStyle === 'island' &&
    isSensitiveIslandFillPolicy(group.islandMotionPolicy)
  );
}

function isSensitiveIslandFillGroupWithOverscan(
  group: ReturnType<typeof compileJob>['groups'][number],
): boolean {
  return (
    group.kind === 'fill' &&
    group.fillStyle === 'island' &&
    isSensitiveIslandFillPolicy(group.islandMotionPolicy) &&
    group.overscanMm > 0
  );
}

// H12 (AUDIT-2026-06-10): the engrave luma comes from the import-time
// capped decode (ADR-037 — a TRACE runtime cap), and compileRasterGroup
// nearest-neighbor UPSAMPLES it to the burn grid while the canvas renders
// the sharp full-resolution bitmap. The burn cannot deliver detail the
// stored luma doesn't have — say so before the operator commits material.
function rasterUpsampleWarning(
  obj: RasterImage,
  outputLayers: ReadonlyArray<Layer>,
  project: Project,
): string | null {
  const layer = outputLayers.find((operation) => sceneObjectUsesOperation(obj, operation));
  if (layer === undefined || layer.mode !== 'image' || obj.role === 'trace-source') return null;
  return describeRasterUpsample(obj, layer, project);
}

function describeRasterUpsample(obj: RasterImage, layer: Layer, project: Project): string | null {
  if (layer.passThrough) return null;
  const bounds = rasterBoundsInMachineCoords(obj, project.device);
  const burnWidth = pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const burnHeight = pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  if (burnWidth <= obj.pixelWidth && burnHeight <= obj.pixelHeight) return null;
  return (
    `Image "${obj.source}" stores ${obj.pixelWidth} × ${obj.pixelHeight} px but the burn grid wants ` +
    `${burnWidth} × ${burnHeight} px at ${layer.linesPerMm} lines/mm — the engrave will be softer than ` +
    'the canvas preview. Lower lines/mm, shrink the image, or re-import a higher-resolution file.'
  );
}

function traceVectorWarning(
  source: string,
  mode: Exclude<LayerMode, 'image'>,
  project: Project,
): string {
  const dialect = resolveGrblDialect(project.device);
  const powerMode = mode === 'fill' ? dialect.fillPowerMode : dialect.cutPowerMode;
  if (mode === 'fill') {
    return (
      `Trace "${source}" is vector Fill output, not raster image engraving. ` +
      `It will run as ${powerModeCommand(powerMode)} ${powerModeLabel(powerMode)} fill sweeps from traced vector geometry; ` +
      'tiny traced text can stay wavy if the source outline is poor.'
    );
  }
  return (
    `Trace "${source}" is vector Line output, not raster image engraving. ` +
    `It will run as ${powerModeCommand(powerMode)} ${powerModeLabel(powerMode)} vector moves ` +
    'and can cut if power/speed are too aggressive.'
  );
}

function powerModeCommand(mode: GrblPowerMode): 'M3' | 'M4' {
  return mode === 'dynamic' ? 'M4' : 'M3';
}

function powerModeLabel(mode: GrblPowerMode): 'constant-power' | 'dynamic-power' {
  return mode === 'dynamic' ? 'dynamic-power' : 'constant-power';
}
