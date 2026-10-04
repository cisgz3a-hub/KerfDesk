import { prepareProjectSaveRequest } from './project-save-preparation';
import type { ProjectSavePreparationMessage } from './project-save-preparation-client';

self.onmessage = (event: MessageEvent<ProjectSavePreparationMessage>): void => {
  self.postMessage(prepareProjectSaveRequest(event.data));
};
