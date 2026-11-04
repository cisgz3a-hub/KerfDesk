import {
  outputPreparationWorkReaches,
  outputVectorPreparationTooComplex,
} from '../../core/job/preparation-complexity';
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
// This is an interactive execution threshold, not the core large-job warning
// or an output cap. Counting includes laser passes and CNC depth passes, so a
// modest drawing that emits a large route also leaves the UI thread.
const DIRECT_VECTOR_CANVAS_WORK_BUDGET = 20_000;

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
    outputVectorPreparationTooComplex(scopedProject, DIRECT_VECTOR_CANVAS_WORK_BUDGET) ||
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
    if (object.kind !== 'raster-image') continue;
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

// Preview, the estimate, Frame, Start and Save emit, check and time the whole
// program, about 34 µs of UI thread per work unit for a design of outlines
// and small fills (S4-P2-1: 16k units blocked 0.5 s). 2,000 units stay under
// about 70 ms. The 20,000-unit budget above stays for the Machine Setup and
// Design advisories, which compile only and go blank when routed away.
const DIRECT_OUTPUT_WORK_BUDGET = 2_000;

/**
 * Where Preview, the estimate, Frame, Start and Save prepare output: in a
 * worker for every costly job (above), and for any job of DIRECT_OUTPUT_WORK_BUDGET
 * or more when this window can start one. Without workers those mid-sized
 * jobs keep preparing here, as before (ADR-598 Amendment 4).
 */
export function outputPreparationPrefersWorker(
  project: Project,
  outputScope?: OutputScope,
): boolean {
  return (
    costlyCanvasPreparation(project, outputScope) ||
    ordinaryOutputPrefersWorker(project, outputScope)
  );
}

/** The part of outputPreparationPrefersWorker beyond costlyCanvasPreparation. */
export function ordinaryOutputPrefersWorker(project: Project, outputScope?: OutputScope): boolean {
  if (!windowCanStartWorkers()) return false;
  const scoped = outputScope === undefined ? null : validateOutputScope(project.scene, outputScope);
  if (scoped !== null && !scoped.ok) return false;
  const scene = scoped === null ? project.scene : scoped.scene;
  const scopedProject = scene === project.scene ? project : { ...project, scene };
  return outputPreparationWorkReaches(scopedProject, DIRECT_OUTPUT_WORK_BUDGET);
}

// A worker realm has no window; its own compile is already off the UI thread.
function windowCanStartWorkers(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}
