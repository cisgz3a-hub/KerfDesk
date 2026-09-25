import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { vi } from 'vitest';
import { parseDocumentImportSource } from './document-import-source';
import { resetDocumentImportWorkerForTests } from './document-import-worker-client';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';
import { makePng } from './png-incremental-decoder.test-support';
import { resetPngImportWorkerForTests } from './png-import-worker-client';
import type { PngImportWorkerRequest, PngImportWorkerResponse } from './png-import-worker-protocol';
import { importPngStreamToPagedAssets } from './png-paged-import';

type PngRequest = Extract<PngImportWorkerRequest, { readonly kind: 'import-png' }>;
type ImportResponse = PngImportWorkerResponse | DocumentImportWorkerResponse;

export const pngWorkerRequests: PngRequest[] = [];
export const documentWorkerRequests: DocumentImportWorkerRequest[] = [];

/** jsdom transport for the actual document parser and streamed PNG decoder.
 * It replaces browser Worker delivery, never parser, pixels, or storage logic. */
export class InlinePngWorker {
  onmessage: ((event: MessageEvent<ImportResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly controller = new AbortController();

  postMessage(request: PngImportWorkerRequest | DocumentImportWorkerRequest): void {
    if (request.kind === 'cancel') {
      this.controller.abort();
      return;
    }
    const pending =
      request.kind === 'import-png' ? this.importPng(request) : this.importDocument(request);
    void pending.then(
      (response) => this.respond(response),
      (error: unknown) =>
        this.respond({
          kind: 'error',
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  terminate(): void {
    this.controller.abort();
  }

  private async importPng(request: PngRequest): Promise<PngImportWorkerResponse> {
    pngWorkerRequests.push(request);
    const result = await importPngStreamToPagedAssets(request.stream, request.source, {
      ...request.options,
      signal: this.controller.signal,
    });
    return { kind: 'complete', id: request.id, result };
  }

  private importDocument(
    request: DocumentImportWorkerRequest,
  ): Promise<DocumentImportWorkerResponse> {
    documentWorkerRequests.push(request);
    this.respond({ kind: 'progress', id: request.id, phase: 'reading' });
    return parseDocumentImportSource(request, () => {
      this.respond({ kind: 'progress', id: request.id, phase: 'parsing' });
    });
  }

  private respond(data: ImportResponse): void {
    if (!this.controller.signal.aborted) {
      this.onmessage?.({ data } as MessageEvent<ImportResponse>);
    }
  }
}

export function installSvgImageTestEnvironment(): void {
  pngWorkerRequests.length = 0;
  documentWorkerRequests.length = 0;
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('Worker', InlinePngWorker);
}

export async function resetSvgImageTestEnvironment(): Promise<void> {
  resetDocumentImportWorkerForTests();
  await resetPngImportWorkerForTests();
  vi.unstubAllGlobals();
}

export function realPng(): Uint8Array {
  return makePng({
    // Genuine pixels and CRCs, with dimensions selecting qualified decoding.
    // The tiny compressed source becomes a bounded 8192-pixel luma result.
    width: 20_000,
    height: 1,
    colorType: 0,
    pixelsPerMetre: 11_811,
    rows: [Array.from({ length: 20_000 }, (_, index) => (index < 10_000 ? 0 : 255))],
  });
}
