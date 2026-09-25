import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPdfArtwork } from './pdf-artwork-source';

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), createWorker: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument: pdf.getDocument,
  PDFWorker: { create: pdf.createWorker },
  AnnotationMode: { ENABLE: 1 },
  OPS: {},
}));

class StubWorker extends EventTarget {
  static instances: StubWorker[] = [];
  static failConstruction = false;
  readonly terminate = vi.fn();
  constructor() {
    super();
    if (StubWorker.failConstruction) throw new Error('worker construction blocked');
    StubWorker.instances.push(this);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function file(): File {
  return {
    name: 'page.pdf',
    arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer,
  } as File;
}

function worker(): StubWorker {
  const current = StubWorker.instances.at(-1);
  if (current === undefined) throw new Error('Missing PDF worker');
  return current;
}

describe('PDF worker ownership', () => {
  const destroyWorker = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    StubWorker.instances = [];
    StubWorker.failConstruction = false;
    vi.stubGlobal('Worker', StubWorker);
    pdf.createWorker.mockReturnValue({ destroy: destroyWorker });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes an explicit worker port and disposes the document and native worker', async () => {
    const task = {
      promise: Promise.resolve({ numPages: 2 }),
      destroy: vi.fn(async () => undefined),
    };
    pdf.getDocument.mockReturnValue(task);
    const source = await openPdfArtwork(file());
    expect(pdf.createWorker).toHaveBeenCalledWith({ port: worker() });
    expect(pdf.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ worker: { destroy: destroyWorker } }),
    );
    await source.dispose();
    await source.dispose();
    expect(task.destroy).toHaveBeenCalledOnce();
    expect(worker().terminate).toHaveBeenCalledOnce();
    expect(destroyWorker).toHaveBeenCalledOnce();
  });

  it('rejects worker startup failure even when PDF.js disposal cannot answer', async () => {
    const task = {
      promise: deferred<never>().promise,
      destroy: vi.fn(() => deferred<undefined>().promise),
    };
    pdf.getDocument.mockReturnValue(task);
    const pending = openPdfArtwork(file());
    await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledOnce());
    worker().dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('PDF worker stopped');
    expect(task.destroy).toHaveBeenCalledOnce();
    expect(destroyWorker).toHaveBeenCalledOnce();
    expect(pdf.createWorker).toHaveBeenCalledOnce();
  });

  it('rejects active and subsequent page requests after a worker failure', async () => {
    const getPage = vi.fn(() => deferred<never>().promise);
    const task = {
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy: vi.fn(async () => undefined),
    };
    pdf.getDocument.mockReturnValue(task);
    const source = await openPdfArtwork(file());
    const pending = source.prepare(1);
    worker().dispatchEvent(new Event('messageerror'));
    await expect(pending).rejects.toThrow('PDF worker stopped');
    await expect(source.prepare(2)).rejects.toThrow('PDF worker stopped');
    expect(getPage).toHaveBeenCalledOnce();
    await source.dispose();
  });

  it('never starts PDF.js without a native worker when worker construction fails', async () => {
    StubWorker.failConstruction = true;
    await expect(openPdfArtwork(file())).rejects.toThrow('worker construction blocked');
    expect(pdf.getDocument).not.toHaveBeenCalled();
    expect(pdf.createWorker).not.toHaveBeenCalled();
  });
});
