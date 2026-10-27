import { Blob as NodeBlob } from 'node:buffer';
import { vi } from 'vitest';
import { resetImportWorkerForTests } from './import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';
import { packDxfResult } from './packed-dxf-result';
import { parseDxfBlob } from './parse-dxf-blob';

export const dxfWorkerRequests: ImportWorkerRequest[] = [];

/** jsdom transport for the import worker's actual DXF parse.
 * It replaces browser Worker delivery, never the parser or its packed result. */
export class InlineDxfWorker {
  onmessage: ((event: MessageEvent<ImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  private terminated = false;

  postMessage(request: ImportWorkerRequest): void {
    dxfWorkerRequests.push(request);
    if (request.kind !== 'dxf') throw new Error(`InlineDxfWorker cannot parse '${request.kind}'`);
    void parseDxfBlob(request.blob, { id: request.objectId, source: request.source }).then(
      (result) => this.respond({ id: request.id, kind: 'dxf', result: packDxfResult(result) }),
      (error: unknown) =>
        this.respond({
          id: request.id,
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  terminate(): void {
    this.terminated = true;
  }

  private respond(data: ImportWorkerResponse): void {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent<ImportWorkerResponse>);
  }
}

export function installDxfImportWorker(): void {
  dxfWorkerRequests.length = 0;
  // jsdom's Blob has no stream(), which the worker's line reader consumes.
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Worker', InlineDxfWorker);
}

export function resetDxfImportWorker(): void {
  resetImportWorkerForTests();
  vi.unstubAllGlobals();
}
