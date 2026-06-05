// pre-emit — cheap, project-level preflight that runs BEFORE compileJob, so a
// job that would freeze the app (a huge raster engrave) is rejected before any
// large allocation: the resampled luma buffer, the dither's Uint16 + Float32
// buffers, and the full G-code string (roadmap P1-A, the "app froze after an
// image job / image scan" class).
//
// It sizes each output raster from its machine-coord bounds x the layer's
// lines/mm WITHOUT compiling, then checks the pixel budget. Returns the same
// PreflightResult shape as runPreflight so callers (emitGcode, the live
// estimate) treat both uniformly. Pure-core: no clock, no random, no I/O.

import { pixelExtentForMm } from '../raster';
import { evaluateRasterBudget } from '../raster/raster-budget';
import { rasterBoundsInMachineCoords } from '../job/raster-bounds';
import type { Project } from '../scene';
import type { PreflightIssue, PreflightResult } from './preflight';

export function runPreEmitPreflight(project: Project): PreflightResult {
  const issues: PreflightIssue[] = [];
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image' || obj.role === 'trace-source') continue;
    const layer = project.scene.layers.find(
      (l) => l.output && l.mode === 'image' && l.color === obj.color,
    );
    if (layer === undefined) continue;
    const bounds = rasterBoundsInMachineCoords(obj, project.device);
    const pw = pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
    const ph = pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
    const verdict = evaluateRasterBudget(pw, ph);
    if (verdict.kind === 'too-large') {
      issues.push({
        code: 'raster-too-large',
        message: `Layer ${layer.id} image would engrave at ${pw}x${ph} px (${verdict.reason}). Lower the layer resolution (lines/mm) or scale the image down before engraving.`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}
