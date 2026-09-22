import { unpackProjectMessage } from '../packed-project-transfer';
import { prepareAutosaveRecord } from './autosave-record';
import type { AutosavePreparationRequest } from './autosave-preparation-client';

self.onmessage = (event: MessageEvent<AutosavePreparationRequest>): void => {
  const { project, savedAt, sessionId, storageKey } = event.data;
  // The project may have arrived as packed geometry (ADR-346).
  self.postMessage(
    prepareAutosaveRecord(unpackProjectMessage(project), savedAt, sessionId, storageKey),
  );
};
