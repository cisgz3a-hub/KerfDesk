import { Blob as NodeBlob } from 'node:buffer';
import { vi } from 'vitest';
import { parseDocumentImportSource } from './document-import-source';
import { resetDocumentImportWorkerForTests } from './document-import-worker-client';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';
import { resetImportWorkerForTests } from './import-worker-client';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';
import { packDxfResult } from './packed-dxf-result';
import { parseDxfBlob } from './parse-dxf-blob';

type Request = ImportWorkerRequest | DocumentImportWorkerRequest;
type Response = ImportWorkerResponse | DocumentImportWorkerResponse;

export const dxfWorkerRequests: ImportWorkerRequest[] = [];
export const svgWorkerRequests: DocumentImportWorkerRequest[] = [];

/** jsdom transport for the import workers' actual DXF and SVG parses.
 * It replaces browser Worker delivery, never the parsers or their results. */
export class InlineImportWorker {
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  onerror: (() => void) | null = null;
  private terminated = false;

  postMessage(request: Request): void {
    void this.parse(request).then(
      (response) => this.respond(response),
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

  private async parse(request: Request): Promise<Response> {
    if (request.kind === 'dxf') {
      dxfWorkerRequests.push(request);
      const result = await parseDxfBlob(request.blob, {
        id: request.objectId,
        source: request.source,
      });
      return { id: request.id, kind: 'dxf', result: packDxfResult(result) };
    }
    if (request.kind === 'svg') {
      svgWorkerRequests.push(request);
      return parseDocumentImportSource(request, () => undefined);
    }
    throw new Error(`InlineImportWorker cannot parse '${request.kind}'`);
  }

  private respond(data: Response): void {
    if (!this.terminated) this.onmessage?.({ data } as MessageEvent<Response>);
  }
}

export function installImportWorkers(): void {
  dxfWorkerRequests.length = 0;
  svgWorkerRequests.length = 0;
  // jsdom's Blob has no stream(), which the workers' readers consume.
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('Worker', InlineImportWorker);
}

export function resetImportWorkers(): void {
  resetImportWorkerForTests();
  resetDocumentImportWorkerForTests();
  vi.unstubAllGlobals();
}
