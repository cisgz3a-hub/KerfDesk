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

  it('imports through the disclosed main-thread fallback when worker construction fails', async () => {
    vi.stubGlobal('Worker', function WorkerUnavailable(): never {
      throw new Error('workers blocked');
    });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="5" y="5" width="30" height="20" fill="none" stroke="#f00"/></svg>';
    const blob = { size: svg.length } as unknown as Blob;
    const readFile = vi.fn(async () => svg);
    const importObject = vi.fn(() => ({ kind: 'added' as const }));
    const pushToast = vi.fn();

    await importSvgFiles(
      [{ name: 'fallback.svg', text: readFile, blob: async () => blob }],
      importObject,
      pushToast,
    );

    expect(readFile).toHaveBeenCalledOnce();
    expect(importObject).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/fallback\.svg.*main thread.*unresponsive/i),
      'warning',
    );
  });
});
