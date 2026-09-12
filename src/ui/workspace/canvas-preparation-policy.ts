import { outputVectorPreparationTooComplex } from '../../core/job/preparation-complexity';
import {
  rasterPreparationTooComplex,
  rasterPreparationWorkUnits,
} from '../../core/job/raster-preparation-complexity';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  validateOutputScope,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/effective-output';
import { projectHasPagedRasterAssets } from '../import/paged-raster-hydration';

export type CanvasPreparationClass = 'direct' | 'background-worker';

// UI execution routing, separate from the core 50M-pixel advisory. A 1254²
// image already caused ~400ms browser tasks in ordinary Design through idle
// markers and ETA; source decode also matters when the output grid is tiny.
// Keep only modest source + output work direct. Workers still prepare every
// requested pixel/pass with the same compiler, without a new output limit.
const DIRECT_RASTER_CANVAS_WORK_BUDGET = 250_000;

/** Shared routing policy for costly output-derived canvas work. */
export function classifyCanvasPreparation(
  project: Project,
  outputScope?: OutputScope,
): CanvasPreparationClass {
  const scoped = outputScope === undefined ? null : validateOutputScope(project.scene, outputScope);
  if (scoped !== null && !scoped.ok) return 'direct';
  const scene = scoped === null ? project.scene : scoped.scene;
  const scopedProject = scene === project.scene ? project : { ...project, scene };
  return projectHasPagedRasterAssets(scopedProject) ||
    cncReliefPreparationIsCostly(scopedProject) ||
    operationAmplifiesPreparation(scopedProject) ||
    outputVectorPreparationTooComplex(scopedProject) ||
    interactiveRasterPreparationIsCostly(scopedProject) ||
    rasterPreparationTooComplex(scopedProject)
    ? 'background-worker'
    : 'direct';
}

function interactiveRasterPreparationIsCostly(project: Project): boolean {
  if (project.machine?.kind === 'cnc') return false;
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  let sourcePixels = 0;
  for (const object of project.scene.objects) {
    if (object.kind !== 'raster-image' || object.role === 'trace-source') continue;
    const hasImageOutput = operations.some(
      (operation) =>
        sceneObjectUsesOperation(object, operation) &&
        effectiveOperationForObject(operation, object).mode === 'image',
    );
    if (!hasImageOutput) continue;
    // Decode is shared by operation consumers of the same source. Count it
    // once per raster; output grids/passes below count every effective image
    // operation. Visibility does not disable output. Invalid dimensions keep
    // their existing compile-time validation rather than throwing in the UI.
    if (object.pixelWidth > 0 && object.pixelHeight > 0) {
      sourcePixels += object.pixelWidth * object.pixelHeight;
    }
    if (sourcePixels >= DIRECT_RASTER_CANVAS_WORK_BUDGET) return true;
  }
  return sourcePixels + rasterPreparationWorkUnits(project) >= DIRECT_RASTER_CANVAS_WORK_BUDGET;
}

function operationAmplifiesPreparation(project: Project): boolean {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  if (project.machine?.kind === 'cnc') {
    return operations.some((layer) => {
      const cutType = (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType;
      return (
        cutType === 'pocket' ||
        cutType === 'v-carve' ||
        cutType === 'inlay-pair' ||
        cutType === 'relief-rough' ||
        cutType === 'relief-finish'
      );
    });
  }
  if (operations.some((layer) => layer.mode === 'fill' && layer.fillStyle !== 'scanline')) {
    return true;
  }
  return project.scene.objects.some((object) =>
    operations.some((operation) => {
      if (!sceneObjectUsesOperation(object, operation)) return false;
      const effective = effectiveOperationForObject(operation, object);
      return effective.mode === 'fill' && effective.fillStyle !== 'scanline';
    }),
  );
}

function cncReliefPreparationIsCostly(project: Project): boolean {
  return (
    project.machine?.kind === 'cnc' &&
    project.scene.layers.some((layer) => layer.output) &&
    project.scene.objects.some((object) => object.kind === 'relief')
  );
}

export function costlyCanvasPreparation(project: Project, outputScope?: OutputScope): boolean {
  return classifyCanvasPreparation(project, outputScope) === 'background-worker';
}
