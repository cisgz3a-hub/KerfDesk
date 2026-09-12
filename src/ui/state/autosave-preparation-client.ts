import type { Project } from '../../core/scene';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { prepareAutosaveRecord, type AutosavePreparation } from './autosave-record';

export type AutosavePreparationRequest = {
  readonly project: Project;
  readonly savedAt: number;
  readonly sessionId: string;
  readonly storageKey: string;
};

// Each interval write owns a short-lived worker. Keep serialization and recovery
// validation off the canvas thread, and release their temporary project/JSON
// copies before the durable service commits the returned record.
export async function prepareAutosaveRecordOffThread(
  project: Project,
  savedAt: number,
  sessionId: string,
  storageKey: string,
): Promise<AutosavePreparation> {
  if (typeof Worker === 'undefined') {
    return prepareAutosaveRecord(project, savedAt, sessionId, storageKey);
  }
  return new Promise((resolve) => {
    reserveWorkerMemory((release) => {
      prepareWithWorker({ project, savedAt, sessionId, storageKey }, resolve, release);
    });
  });
}

function prepareWithWorker(
  request: AutosavePreparationRequest,
  resolve: (result: AutosavePreparation) => void,
  release: () => void,
): void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./autosave-preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    resolve(preparationFailure(error));
    release();
    return;
  }
  let finished = false;
  const finish = (result: AutosavePreparation): void => {
    if (finished) return;
    finished = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    // Terminate before another owner may construct/clone into the shared cage.
    release();
    resolve(result);
  };
  worker.onmessage = (event: MessageEvent<AutosavePreparation>) => finish(event.data);
  worker.onerror = (event) => finish(preparationFailure(new Error(event.message)));
  worker.onmessageerror = () =>
    finish(preparationFailure(new Error('Autosave worker response could not be read.')));
  try {
    worker.postMessage(request);
  } catch (error) {
    finish(preparationFailure(error));
  }
}

function preparationFailure(error: unknown): AutosavePreparation {
  return { kind: 'failed', reason: 'storage-error', error };
}
