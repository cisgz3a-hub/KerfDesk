import type { Project } from '../../core/scene';
import { packProjectMessage, type ProjectMessage } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { currentProjectSealKey } from '../licensing/project-seal';
import {
  prepareAutosaveRecord,
  sealAutosavePreparation,
  type AutosavePreparation,
} from './autosave-record';

export type AutosavePreparationRequest = {
  /** A plain Project, or its geometry packed into transferred buffers (ADR-346). */
  readonly project: ProjectMessage;
  readonly savedAt: number;
  readonly sessionId: string;
  readonly storageKey: string;
  /** This computer's project seal key, when the window has one (ADR-592). */
  readonly sealKey?: string;
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
  const prepared = await new Promise<AutosavePreparation>((resolve) => {
    let settled = false;
    let cancelWorker: ((error: Error) => void) | undefined;
    const finish = (result: AutosavePreparation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // A module worker can remain silent without raising an error. Bound queue
    // waiting as well: an earlier worker must not block the durable clear tail
    // forever. Failure retains the previous committed recovery generation.
    const timer = setTimeout(() => {
      const error = new Error('Autosave preparation timed out after 60 seconds.');
      cancelWorker?.(error);
      cancelReservation();
      finish(preparationFailure(error));
    }, 60_000);
    const cancelReservation = reserveWorkerMemory((release) => {
      cancelWorker = prepareWithWorker(
        { project, savedAt, sessionId, storageKey },
        finish,
        release,
      );
    });
  });
  return sealAutosavePreparation(prepared);
}

type LocalAutosavePreparationRequest = Omit<AutosavePreparationRequest, 'project'> & {
  readonly project: Project;
};

function prepareWithWorker(
  request: LocalAutosavePreparationRequest,
  resolve: (result: AutosavePreparation) => void,
  release: () => void,
): (error: Error) => void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./autosave-preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    resolve(preparationFailure(error));
    release();
    return () => undefined;
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
    // A dense trace's geometry is transferred as buffers instead of being
    // structured-cloned on the canvas thread every interval (ADR-346).
    const packed = packProjectMessage(request.project);
    const sealKey = currentProjectSealKey();
    const message: AutosavePreparationRequest = {
      ...request,
      project: packed.message,
      ...(sealKey === null ? {} : { sealKey }),
    };
    if (packed.transfer.length === 0) worker.postMessage(message);
    else worker.postMessage(message, packed.transfer);
  } catch (error) {
    finish(preparationFailure(error));
  }
  return (error) => finish(preparationFailure(error));
}

function preparationFailure(error: unknown): AutosavePreparation {
  return { kind: 'failed', reason: 'storage-error', error };
}
