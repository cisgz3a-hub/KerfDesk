import type { EmitGcodeResult } from '../../io/gcode';
import { outputVectorPreparationTooComplex } from '../../core/job/preparation-complexity';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import { validateOutputScope, type OutputScope, type Project } from '../../core/scene';
import type { StartJobPreparation } from './start-job-readiness';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
  SaveOutputPreparationRequest,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';

export function outputPreparationShouldRunOffThread(
  project: Project,
  outputScope?: OutputScope,
): boolean {
  const scoped = outputScope === undefined ? null : validateOutputScope(project.scene, outputScope);
  if (scoped !== null && !scoped.ok) return false;
  const scene = scoped === null ? project.scene : scoped.scene;
  const scopedProject = scene === project.scene ? project : { ...project, scene };
  return (
    outputVectorPreparationTooComplex(scopedProject) || rasterPreparationTooComplex(scopedProject)
  );
}

export function prepareStartOutputOffThread(
  request: StartOutputPreparationRequest,
): Promise<StartJobPreparation> | null {
  const pending = runWorker(request);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'start') throw new Error('Background Start preparation returned no job.');
    return response.result;
  });
}

export function prepareSaveOutputOffThread(
  request: SaveOutputPreparationRequest,
): Promise<EmitGcodeResult> | null {
  const pending = runWorker(request);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'save') throw new Error('Background Save preparation returned no file.');
    return response.result;
  });
}

function runWorker(
  request: OutputPreparationRequest,
): Promise<Exclude<OutputPreparationResponse, { readonly kind: 'error' }>> | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./output-preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<OutputPreparationResponse>): void => {
      worker.terminate();
      if (event.data.kind === 'error') reject(new Error(event.data.message));
      else resolve(event.data);
    };
    worker.onerror = (): void => {
      worker.terminate();
      reject(new Error('Background output preparation worker errored.'));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
