// raster-preparation-complexity — cheap scene counters for image-mode work,
// the raster twin of preparation-complexity.ts. Rasters of any size compile
// and stream (ADR-243), so nothing here refuses anything: the live preview
// and estimate use these counters to stay responsive by pausing above the
// budget, and Job Review uses them to tell the operator a long preparation
// is coming.

import { pixelExtentForMm } from '../raster';
import { MAX_RASTER_WORK_UNITS } from '../raster/raster-budget';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type RasterImage,
} from '../scene';
import { rasterBoundsInMachineCoords } from './raster-bounds';

export const RASTER_PREPARATION_WORK_UNIT_BUDGET = MAX_RASTER_WORK_UNITS;

/**
 * Total pixel-pass work units across every output image operation in the
 * project. Pure counting on scene data — no luma decode, no compile.
 */
export function rasterPreparationWorkUnits(project: Project): number {
  if (project.machine?.kind === 'cnc') return 0;
  let workUnits = 0;
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image' || obj.role === 'trace-source') continue;
    for (const layer of matchingImageLayers(project, obj)) {
      const effectiveLayer = { ...layer, ...(obj.operationOverride ?? {}) };
      workUnits += rasterLayerWorkUnits(obj, effectiveLayer, project);
    }
  }
  return workUnits;
}

/** True when live preview / estimate should pause for canvas responsiveness. */
export function rasterPreparationTooComplex(project: Project): boolean {
  return rasterPreparationWorkUnits(project) > RASTER_PREPARATION_WORK_UNIT_BUDGET;
}

function rasterLayerWorkUnits(obj: RasterImage, layer: Layer, project: Project): number {
  const passes = Math.max(1, Math.floor(layer.passes));
  if (layer.passThrough) return obj.pixelWidth * obj.pixelHeight * passes;
  const bounds = rasterBoundsInMachineCoords(obj, project.device);
  const pixelWidth = pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const pixelHeight = pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  return pixelWidth * pixelHeight * passes;
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
