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
import { evaluateRasterBudget } from '../raster/raster-budget';
import { rasterBoundsInMachineCoords } from '../job/raster-bounds';
import type { Layer, Project, RasterImage } from '../scene';
import { outputOperationLayers, registrationOutputConflict } from '../scene';
import type { PreflightIssue, PreflightResult } from './preflight';

export function runPreEmitPreflight(project: Project): PreflightResult {
  const issues: PreflightIssue[] = [];
  if (registrationOutputConflict(project.scene)) {
    issues.push({
      code: 'registration-both-output',
      message:
        'Registration jig: the box and your artwork are both set to burn. In the Registration Jig panel pick "Burn Box Only" or "Burn Artwork Only" so they do not burn in the same pass.',
    });
  }
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image' || obj.role === 'trace-source') continue;
    const layer = project.scene.layers
      .flatMap((l) => outputOperationLayers(l))
      .find(
        (operationLayer) =>
          operationLayer.color === obj.color &&
          (obj.operationOverride?.mode ?? operationLayer.mode) === 'image',
      );
    if (layer === undefined) continue;
    const effectiveLayer = { ...layer, ...(obj.operationOverride ?? {}) };
    const {
      pixelWidth: pw,
      pixelHeight: ph,
      remedy,
    } = rasterBudgetDimensions(obj, effectiveLayer, project);
    const verdict = evaluateRasterBudget(pw, ph);
    if (verdict.kind === 'too-large') {
      issues.push({
        code: 'raster-too-large',
        message: `Layer ${layer.id} image would engrave at ${pw}x${ph} px (${verdict.reason}). ${remedy}`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
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
