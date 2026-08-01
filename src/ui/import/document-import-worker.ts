/// <reference lib="webworker" />

import { parseDocumentImportSource } from './document-import-source';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

self.onmessage = (event: MessageEvent<DocumentImportWorkerRequest>): void => {
  void parseRequest(event.data);
};

async function parseRequest(request: DocumentImportWorkerRequest): Promise<void> {
  try {
    postProgress(request.id, 'reading');
    const response = await parseDocumentImportSource(request, () =>
      postProgress(request.id, 'parsing'),
    );
    self.postMessage(response);
  } catch (error) {
    const response: DocumentImportWorkerResponse = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
}

function postProgress(
  id: number,
  phase: Extract<DocumentImportWorkerResponse, { kind: 'progress' }>['phase'],
): void {
  const response: DocumentImportWorkerResponse = { id, kind: 'progress', phase };
  self.postMessage(response);
}
