import { prepareAutosaveRecord } from './autosave-record';
import type { AutosavePreparationRequest } from './autosave-preparation-client';

self.onmessage = (event: MessageEvent<AutosavePreparationRequest>): void => {
  const { project, savedAt, sessionId, storageKey } = event.data;
  self.postMessage(prepareAutosaveRecord(project, savedAt, sessionId, storageKey));
};
