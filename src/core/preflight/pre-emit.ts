// pre-emit — cheap, project-level preflight that runs BEFORE compileJob, so a
// job that would freeze the app (a huge raster engrave) is rejected before any
// large allocation: the resampled luma buffer, the dither's Uint16 + Float32
// buffers, and the full G-code string (roadmap P1-A, the "app froze after an
// image job / image scan" class).
//
// It sizes each output raster from the exact pixel grid compileJob will use:
// bounds x lines/mm for normal image mode, source pixels for Pass-through.
// Returns the same PreflightResult shape as runPreflight so callers (emitGcode,
// the live estimate) treat both uniformly. Pure-core: no clock, no random, no
// I/O.

import { pixelExtentForMm } from '../raster';
import {
  evaluateRasterBudget,
  STREAMED_RASTER_PIXEL_THRESHOLD,
  supportsStreamedRasterRows,
} from '../raster/raster-budget';
import { rasterBoundsInMachineCoords } from '../job/raster-bounds';
import type { Layer, Project, RasterImage } from '../scene';
import { outputOperationLayers, sceneObjectUsesOperation } from '../scene';
import type { PreflightIssue, PreflightResult } from './preflight';
import { controlledLaserOffTravelFeedIssue } from './laser-off-motion-policy';
import { operationScanOffsetIssues } from './scan-offset-policy';

export function runPreEmitPreflight(project: Project): PreflightResult {
  const issues: PreflightIssue[] = [];
  const controlledFeed = project.device.controlledLaserOffTravelFeedMmPerMin;
  const controlledTravelIssue = controlledLaserOffTravelFeedIssue(project.device);
  if (
    controlledFeed !== undefined &&
    (!Number.isFinite(controlledFeed) || controlledFeed <= 0) &&
    controlledTravelIssue !== null
  ) {
    issues.push({ code: 'speed-out-of-range', message: controlledTravelIssue });
  }
  // Vector/fill complexity never refuses here (rule 7 / ADR-241): compile
  // handles any segment count, so over-budget scenes flow through and surface
  // as a Job Review "large job" advisory instead. Preview and the live
  // estimate keep their own cheap upstream gates for canvas responsiveness.
  issues.push(...rasterBudgetIssues(project));
  issues.push(...operationScanOffsetIssues(project, { nonFiniteOnly: true }));
  return { ok: issues.length === 0, issues };
}

function rasterBudgetIssues(project: Project): PreflightIssue[] {
  if (project.machine?.kind === 'cnc') return [];
  const issues: PreflightIssue[] = [];
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image' || obj.role === 'trace-source') continue;
    for (const layer of matchingImageLayers(project, obj)) {
      const issue = rasterBudgetIssue(obj, layer, project);
      if (issue !== null) issues.push(issue);
    }
  }
  return issues;
}

function matchingImageLayers(project: Project, obj: RasterImage): Layer[] {
  return project.scene.layers
    .flatMap((layer) => outputOperationLayers(layer))
    .filter(
      (layer) =>
        sceneObjectUsesOperation(obj, layer) &&
        (obj.operationOverride?.mode ?? layer.mode) === 'image',
    );
}

function rasterBudgetIssue(
  obj: RasterImage,
  layer: Layer,
  project: Project,
): PreflightIssue | null {
  const effectiveLayer = { ...layer, ...(obj.operationOverride ?? {}) };
  const {
    pixelWidth: pw,
    pixelHeight: ph,
    remedy,
  } = rasterBudgetDimensions(obj, effectiveLayer, project);
  const verdict = evaluateRasterBudget(pw, ph, {
    sourcePixelCount: obj.pixelWidth * obj.pixelHeight,
    ditherAlgorithm: effectiveLayer.ditherAlgorithm,
    passes: effectiveLayer.passes,
    streamedRows:
      pw * ph > STREAMED_RASTER_PIXEL_THRESHOLD &&
      obj.imageMaskId === undefined &&
      supportsStreamedRasterRows(effectiveLayer.ditherAlgorithm),
  });
  return verdict.kind === 'ok'
    ? null
    : {
        code: 'raster-too-large',
        message: `Layer ${layer.id} image would engrave at ${pw}x${ph} px (${verdict.reason}). ${remedy}`,
      };
}

function rasterBudgetDimensions(
  obj: RasterImage,
  layer: Layer,
  project: Project,
): {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly remedy: string;
} {
  if (layer.passThrough) {
    return {
      pixelWidth: obj.pixelWidth,
      pixelHeight: obj.pixelHeight,
      remedy: 'Disable Pass-through or import a smaller/preprocessed image before engraving.',
    };
  }
  const bounds = rasterBoundsInMachineCoords(obj, project.device);
  return {
    pixelWidth: pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm),
    pixelHeight: pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm),
    remedy: 'Lower the layer resolution (lines/mm) or scale the image down before engraving.',
  };
}
