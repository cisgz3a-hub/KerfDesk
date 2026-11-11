import type { Project } from '../../core/scene';
import { packProjectMessage, type ProjectMessage } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { currentProjectSealKey } from '../licensing/project-seal';
import type { AutosaveIndexedDbMutation } from './autosave-indexeddb';
import {
  prepareAutosaveRecord,
  sealAutosavePreparation,
  UnsupportedAutosaveVersionError,
  type AutosavePreparation,
  type AutosaveRecord,
} from './autosave-record';

export type AutosavePreparationRequest = {
  /** A plain Project, or its geometry packed into transferred buffers (ADR-346). */
  readonly project: ProjectMessage;
  readonly savedAt: number;
  readonly sessionId: string;
  readonly storageKey: string;
  /** This computer's project seal key, when the window has one (ADR-592). */
  readonly sealKey?: string;
  /** Keep the record in the worker and commit it from there (ADR-305 Amendment 1). */
  readonly holdForCommit?: boolean;
};

/** What the window asks of a worker that holds a prepared record. */
export type AutosaveWorkerCommand =
  | { readonly kind: 'commit'; readonly expectedEpoch: number }
  | { readonly kind: 'take-record' };

export type AutosaveWorkerReply =
  | { readonly kind: 'held'; readonly storageKey: string }
  | { readonly kind: 'commit-result'; readonly result: AutosaveIndexedDbMutation }
  | {
      readonly kind: 'commit-error';
      readonly unsupportedVersion: boolean;
      readonly message: string;
    }
  | { readonly kind: 'record'; readonly record: AutosaveRecord };

/**
 * A record prepared by a worker that still holds it. The window never receives
 * the project text unless the IndexedDB commit fails and the localStorage
 * fallback needs it. The worker and its memory-lane reservation live until
 * `commit` succeeds, `takeRecord` answers or `release` is called.
 */
export type AutosaveHeldPreparation = {
  readonly kind: 'held';
  readonly storageKey: string;
  /** Commits from the worker. Resolves and rejects as the repository's commit does. */
  commit(expectedEpoch: number): Promise<AutosaveIndexedDbMutation>;
  /** Brings the record to the window and retires the worker. */
  takeRecord(): Promise<AutosaveRecord>;
  /** Retires the worker. Safe to call again, and after the other two. */
  release(): void;
};

/** Preparation outlived its deadline; the failure toast names this, not storage. */
export class AutosavePreparationTimeoutError extends Error {
  constructor() {
    super('Autosave preparation timed out after 60 seconds.');
    this.name = 'AutosavePreparationTimeoutError';
  }
}

const WORKER_DEADLINE_MS = 60_000;

// What the window itself paid to hand the last project to the worker: packing
// its geometry and the structured clone inside postMessage. With the commit in
// the worker this is the only part of an interval autosave that grows with the
// project on the canvas thread, so the job-time gate watches it.
let lastHandOffMs: number | null = null;

/** Canvas-thread milliseconds of the last hand-off, or null before the first. */
export function lastAutosaveHandOffMs(): number | null {
  return lastHandOffMs;
}

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
  const prepared = await startPreparation({ project, savedAt, sessionId, storageKey }, false);
  if (prepared.kind !== 'held') return sealAutosavePreparation(prepared);
  // Only a worker that was asked to hold answers 'held'.
  prepared.release();
  return preparationFailure(new Error('Autosave worker kept a record it was not asked to hold.'));
}

/**
 * Prepares in a worker that keeps the record and commits it to IndexedDB
 * itself (ADR-305 Amendment 1). Reading the earlier snapshots back, checking
 * their versions and writing the new one all copy or parse the whole project
 * text; on the canvas thread that measured 150 ms at 10,000 objects and
 * 500-900 ms for a dense trace or a photo, every interval. Without workers the
 * record is prepared here and the caller commits it as before.
 */
export async function prepareAutosaveForWorkerCommit(
  project: Project,
  savedAt: number,
  sessionId: string,
  storageKey: string,
): Promise<AutosavePreparation | AutosaveHeldPreparation> {
  if (typeof Worker === 'undefined') {
    return prepareAutosaveRecord(project, savedAt, sessionId, storageKey);
  }
  const prepared = await startPreparation({ project, savedAt, sessionId, storageKey }, true);
  return prepared.kind === 'held' ? prepared : sealAutosavePreparation(prepared);
}

type LocalAutosavePreparationRequest = Omit<
  AutosavePreparationRequest,
  'project' | 'holdForCommit'
> & {
  readonly project: Project;
};

function startPreparation(
  request: LocalAutosavePreparationRequest,
  holdForCommit: boolean,
): Promise<AutosavePreparation | AutosaveHeldPreparation> {
  return new Promise((resolve) => {
    let settled = false;
    let cancelWorker: ((error: Error) => void) | undefined;
    const finish = (result: AutosavePreparation | AutosaveHeldPreparation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // A module worker can remain silent without raising an error. Bound queue
    // waiting as well: an earlier worker must not block the durable clear tail
    // forever. Failure retains the previous committed recovery generation.
    const timer = setTimeout(() => {
      const error = new AutosavePreparationTimeoutError();
      cancelWorker?.(error);
      cancelReservation();
      finish(preparationFailure(error));
    }, WORKER_DEADLINE_MS);
    // Interactive: a recovery copy at most one interval old outranks the
    // background job preparation, which yields its heap and restarts after
    // this short worker (ADR-598 Amendment 3, ADR-288 Amendment 3). Behind a
    // preparation of bed-sized photos the copy otherwise waited minutes.
    const cancelReservation = reserveWorkerMemory(
      (release) => {
        cancelWorker = prepareWithWorker(request, holdForCommit, finish, release);
      },
      { priority: 'interactive' },
    );
  });
}

function prepareWithWorker(
  request: LocalAutosavePreparationRequest,
  holdForCommit: boolean,
  resolve: (result: AutosavePreparation | AutosaveHeldPreparation) => void,
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
  let retired = false;
  const retire = (): void => {
    if (retired) return;
    retired = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    // Terminate before another owner may construct/clone into the shared cage.
    release();
  };
  const finish = (result: AutosavePreparation): void => {
    if (retired) return;
    retire();
    resolve(result);
  };
  worker.onmessage = (event: MessageEvent<AutosavePreparation | AutosaveWorkerReply>) => {
    const reply = event.data;
    if (reply.kind === 'ok' || reply.kind === 'failed') finish(reply);
    else if (reply.kind === 'held')
      resolve(heldPreparation(worker, reply.storageKey, retire, () => retired));
    else finish(preparationFailure(new Error('Autosave worker answered out of turn.')));
  };
  worker.onerror = (event) => finish(preparationFailure(new Error(event.message)));
  worker.onmessageerror = () =>
    finish(preparationFailure(new Error('Autosave worker response could not be read.')));
  try {
    const handOffStarted = performance.now();
    // A dense trace's geometry is transferred as buffers instead of being
    // structured-cloned on the canvas thread every interval (ADR-346).
    const packed = packProjectMessage(request.project);
    const sealKey = currentProjectSealKey();
    const message: AutosavePreparationRequest = {
      ...request,
      project: packed.message,
      ...(sealKey === null ? {} : { sealKey }),
      ...(holdForCommit ? { holdForCommit } : {}),
    };
    if (packed.transfer.length === 0) worker.postMessage(message);
    else worker.postMessage(message, packed.transfer);
    lastHandOffMs = performance.now() - handOffStarted;
  } catch (error) {
    finish(preparationFailure(error));
  }
  return (error) => finish(preparationFailure(error));
}

function heldPreparation(
  worker: Worker,
  storageKey: string,
  retire: () => void,
  isRetired: () => boolean,
): AutosaveHeldPreparation {
  // One question at a time: the durable service commits, and only after a
  // failed commit asks for the record.
  const ask = <T>(
    command: AutosaveWorkerCommand,
    answer: (reply: AutosaveWorkerReply) => T,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      // The worker failed, or was released, since it reported the record held.
      if (isRetired()) {
        reject(new Error('Autosave worker is no longer running.'));
        return;
      }
      const lost = (error: Error): void => {
        clearTimeout(timer);
        retire();
        reject(error);
      };
      // A silent worker must not hold the memory lane, or the writes queued
      // behind this one, forever.
      const timer = setTimeout(
        () => lost(new Error('Autosave worker did not answer within 60 seconds.')),
        WORKER_DEADLINE_MS,
      );
      worker.onmessage = (event: MessageEvent<AutosaveWorkerReply>) => {
        clearTimeout(timer);
        try {
          resolve(answer(event.data));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      worker.onerror = (event) => lost(new Error(event.message));
      worker.onmessageerror = () => lost(new Error('Autosave worker response could not be read.'));
      try {
        worker.postMessage(command);
      } catch (error) {
        lost(error instanceof Error ? error : new Error(String(error)));
      }
    });
  return {
    kind: 'held',
    storageKey,
    commit: (expectedEpoch) =>
      ask({ kind: 'commit', expectedEpoch }, (reply) => {
        if (reply.kind === 'commit-result') {
          retire();
          return reply.result;
        }
        // The worker keeps the record: the caller may still take it for the
        // localStorage fallback. An error does not survive the worker boundary
        // as its class, so the one the caller tells apart is rebuilt here.
        if (reply.kind === 'commit-error') {
          throw reply.unsupportedVersion
            ? new UnsupportedAutosaveVersionError()
            : new Error(reply.message);
        }
        throw new Error('Autosave worker answered out of turn.');
      }),
    takeRecord: () =>
      ask({ kind: 'take-record' }, (reply) => {
        retire();
        if (reply.kind === 'record') return reply.record;
        throw new Error('Autosave worker answered out of turn.');
      }),
    release: retire,
  };
}

function preparationFailure(error: unknown): AutosavePreparation {
  return { kind: 'failed', reason: 'storage-error', error };
}
