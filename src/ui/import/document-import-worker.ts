/// <reference lib="webworker" />

import { parseDocumentImportText } from './document-import-parse';
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
    const text = await request.blob.text();
    postProgress(request.id, 'parsing');
    const response = parseDocumentImportText(request, text);
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
