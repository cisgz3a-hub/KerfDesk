/// <reference lib="webworker" />

import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { stageAssetPages } from './paged-asset-stager';
import type {
  PagedAssetStageRequest,
  PagedAssetWorkerRequest,
  PagedAssetWorkerResponse,
} from './paged-asset-worker-protocol';

const controllers = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent<PagedAssetWorkerRequest>): void => {
  const request = event.data;
  if (request.kind === 'cancel') {
    controllers.get(request.id)?.abort();
    return;
  }
  void stage(request);
};

async function stage(request: PagedAssetStageRequest): Promise<void> {
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const manifest = await stageAssetPages(
      request.blob,
      {
        ...request.options,
        signal: controller.signal,
        onProgress: (progress) => {
          post({ id: request.id, kind: 'progress', progress });
        },
      },
      new IndexedDbPagedAssetRepository(),
    );
    post({ id: request.id, kind: 'complete', manifest });
  } catch (error) {
    if (controller.signal.aborted) post({ id: request.id, kind: 'cancelled' });
    else post({ id: request.id, kind: 'error', message: toMessage(error) });
  } finally {
    controllers.delete(request.id);
  }
}

function post(response: PagedAssetWorkerResponse): void {
  self.postMessage(response);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
