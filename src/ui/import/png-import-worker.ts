/// <reference lib="webworker" />

import { importPngStreamToPagedAssets } from './png-paged-import';
import type { PngImportWorkerRequest, PngImportWorkerResponse } from './png-import-worker-protocol';

const controllers = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent<PngImportWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'cancel') {
    controllers.get(request.id)?.abort();
    return;
  }
  void importPng(request);
};

async function importPng(
  request: Extract<PngImportWorkerRequest, { readonly kind: 'import-png' }>,
): Promise<void> {
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const result = await importPngStreamToPagedAssets(request.stream, request.source, {
      ...request.options,
      signal: controller.signal,
      onProgress: (progress) => {
        post({ id: request.id, kind: 'progress', progress });
      },
    });
    post({ id: request.id, kind: 'complete', result });
  } catch (error) {
    if (controller.signal.aborted && isAbortError(error)) {
      post({ id: request.id, kind: 'cancelled' });
    } else {
      post({ id: request.id, kind: 'error', message: toMessage(error) });
    }
  } finally {
    controllers.delete(request.id);
  }
}

function post(response: PngImportWorkerResponse): void {
  if (response.kind === 'complete' && response.result.kind === 'ok') {
    self.postMessage(response, [response.result.thumbnail.bytes.buffer]);
    return;
  }
  self.postMessage(response);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
