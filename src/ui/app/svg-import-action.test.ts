import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDocumentImportWorkerForTests } from '../import/document-import-worker-client';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from '../import/document-import-worker-protocol';
import { importSvgFiles } from './svg-import-action';

class StubWorker {
  static instance: StubWorker | null = null;
  onmessage: ((event: MessageEvent<DocumentImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  request: DocumentImportWorkerRequest | null = null;
  constructor() {
    StubWorker.instance = this;
  }
  postMessage(request: DocumentImportWorkerRequest): void {
    this.request = request;
  }
  terminate(): void {
    this.request = null;
  }
  reply(response: DocumentImportWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<DocumentImportWorkerResponse>);
  }
}

afterEach(() => {
  resetDocumentImportWorkerForTests();
  vi.unstubAllGlobals();
});

describe('importSvgFiles', () => {
  it('sends a reachable Blob to the document worker without UI-thread text reading', async () => {
    vi.stubGlobal('Worker', StubWorker);
    const text = vi.fn(async () => '<svg/>');
    const source = {
      name: 'part.svg',
      size: 6,
      text,
      blob: async () => new Blob(['<svg/>']),
    };
    const pending = importSvgFiles(
      [source],
      vi.fn(() => ({ kind: 'added' as const })),
      vi.fn(),
    );
    await vi.waitFor(() => expect(StubWorker.instance?.request?.kind).toBe('svg'));
    const request = StubWorker.instance?.request;
    StubWorker.instance?.reply({
      id: request?.id ?? -1,
      kind: 'svg',
      result: {
        object: null,
        stripped: { scripts: 0, foreignObjects: 0, externalLinks: 0, dataUris: 0 },
        notes: ['SVG has no drawable geometry'],
        ignoredTextElements: 0,
        ignoredImageElements: 0,
      },
    });
    await pending;

    expect(text).not.toHaveBeenCalled();
  });
});
