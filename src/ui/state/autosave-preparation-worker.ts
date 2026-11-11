import { unpackProjectMessage } from '../packed-project-transfer';
import { adoptProjectSealKey } from '../licensing/project-seal';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import {
  prepareAutosaveRecord,
  UnsupportedAutosaveVersionError,
  type AutosaveRecord,
} from './autosave-record';
import type {
  AutosavePreparationRequest,
  AutosaveWorkerCommand,
  AutosaveWorkerReply,
} from './autosave-preparation-client';

// A record this worker was asked to keep, with the slot it belongs to. The
// window then asks for the IndexedDB commit to run here, so the project text
// never crosses back to the canvas thread (ADR-305 Amendment 1).
let held: {
  readonly record: AutosaveRecord;
  readonly sessionId: string;
  readonly storageKey: string;
} | null = null;

function reply(message: AutosaveWorkerReply): void {
  self.postMessage(message);
}

async function commitHeld(expectedEpoch: number): Promise<void> {
  try {
    if (held === null) throw new Error('Autosave worker holds no record to commit.');
    // The same database and the same compare-and-swap transaction the window
    // used: the epoch it passes still admits exactly one writer.
    const { record, sessionId, storageKey } = held;
    const result = await new IndexedDbAutosaveRepository().commit(
      { ...record, sessionId, storageKey },
      expectedEpoch,
    );
    reply({ kind: 'commit-result', result });
  } catch (error) {
    reply({
      kind: 'commit-error',
      unsupportedVersion: error instanceof UnsupportedAutosaveVersionError,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function prepare(request: AutosavePreparationRequest): void {
  const { project, savedAt, sessionId, storageKey, sealKey } = request;
  // The window's seal key, so large autosaves are sealed here (ADR-592).
  adoptProjectSealKey(sealKey ?? null);
  // The project may have arrived as packed geometry (ADR-346).
  const prepared = prepareAutosaveRecord(
    unpackProjectMessage(project),
    savedAt,
    sessionId,
    storageKey,
  );
  if (request.holdForCommit !== true || prepared.kind !== 'ok') {
    self.postMessage(prepared);
    return;
  }
  held = { record: prepared.record, sessionId, storageKey };
  reply({ kind: 'held', storageKey });
}

self.onmessage = (
  event: MessageEvent<AutosavePreparationRequest | AutosaveWorkerCommand>,
): void => {
  const message = event.data;
  // A request carries the project; a command names what to do with the record.
  if (!('kind' in message)) {
    prepare(message);
  } else if (message.kind === 'commit') {
    void commitHeld(message.expectedEpoch);
  } else if (held === null) {
    reply({ kind: 'commit-error', unsupportedVersion: false, message: 'No record is held.' });
  } else {
    reply({ kind: 'record', record: held.record });
  }
};
