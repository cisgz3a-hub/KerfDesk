import { outputVectorPreparationTooComplex } from '../../core/job/preparation-complexity';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
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
    rasterPreparationTooComplex(scopedProject)
    ? 'background-worker'
    : 'direct';
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
