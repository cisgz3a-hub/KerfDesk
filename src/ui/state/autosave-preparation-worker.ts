import { unpackProjectMessage } from '../packed-project-transfer';
import { adoptProjectSealKey } from '../licensing/project-seal';
import { prepareAutosaveRecord } from './autosave-record';
import type { AutosavePreparationRequest } from './autosave-preparation-client';

self.onmessage = (event: MessageEvent<AutosavePreparationRequest>): void => {
  const { project, savedAt, sessionId, storageKey, sealKey } = event.data;
  // The window's seal key, so large autosaves are sealed here (ADR-592).
  adoptProjectSealKey(sealKey ?? null);
  // The project may have arrived as packed geometry (ADR-346).
  self.postMessage(
    prepareAutosaveRecord(unpackProjectMessage(project), savedAt, sessionId, storageKey),
  );
};
