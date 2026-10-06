import type { Project } from '../../core/scene';
import { packProjectMessage, type ProjectMessage } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { errorMessage } from './file-action-formatters';

import type { ProjectSavePreparation } from './project-save-preparation';
import { projectSaveGeometryCanPack } from './project-save-packed-eligibility';
export type { ProjectSavePreparation } from './project-save-preparation';

// Returning only the validated bytes avoids cloning the entire normalized
// scene back onto the UI thread. Validation is identical to ordinary Save.
export function prepareProjectSaveOffThread(
  project: Project,
  signal: AbortSignal,
  mode: 'canonical' | 'recovery' = 'canonical',
): Promise<ProjectSavePreparation> {
  if (signal.aborted) return Promise.reject(cancelled());
  if (typeof Worker === 'undefined') {
    return Promise.resolve({
      kind: 'failed',
      reason: 'Project preparation workers are unavailable.',
    });
  }
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let release: () => void = () => undefined;
    let finished = false;
    const finish = (result: ProjectSavePreparation | null): void => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (worker !== null) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      release();
      if (result === null) reject(cancelled());
      else resolve(result);
    };
    const abort = (): void => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    const reservation = reserveWorkerMemory((releaseActive) => {
      release = releaseActive;
      try {
        worker = new Worker(new URL('./project-save-preparation-worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event: MessageEvent<ProjectSavePreparation>) => finish(event.data);
        worker.onerror = (event) => finish(failed(event.message));
        worker.onmessageerror = () =>
          finish(failed('The project worker response could not be read.'));
        const packed =
          mode === 'recovery' || !projectSaveGeometryCanPack(project)
            ? { message: project, transfer: [] }
            : packProjectMessage(project);
        const message: ProjectSavePreparationMessage = {
          project: packed.message,
          mode,
          representation: packed.transfer.length === 0 ? 'original' : 'packed',
        };
        if (packed.transfer.length === 0) worker.postMessage(message);
        else worker.postMessage(message, packed.transfer);
      } catch (error) {
        finish(failed(errorMessage(error)));
      }
    });
    if (worker === null && !finished) release = reservation;
  });
}

function failed(message: string): ProjectSavePreparation {
  return { kind: 'failed', reason: `project preparation failed: ${message}` };
}

function cancelled(): DOMException {
  return new DOMException('Project save cancelled.', 'AbortError');
}

export type ProjectSavePreparationMessage = {
  readonly project: ProjectMessage;
  readonly mode: 'canonical' | 'recovery';
  readonly representation: 'original' | 'packed';
};
