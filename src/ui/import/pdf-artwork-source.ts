import type * as PdfJs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfVectorPage } from '../../io/pdf/pdf-vector-page';
import {
  pageCanvas,
  type PagedArtworkSource,
  type PreparedArtworkPage,
} from './paged-artwork-source';

export async function openPdfArtwork(file: File): Promise<PagedArtworkSource> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder('ascii').decode(data.subarray(0, 1024)).includes('%PDF-')) {
    throw new Error(
      file.name.toLowerCase().endsWith('.ai')
        ? 'This Illustrator file has no PDF-compatible document. Save it with PDF compatibility or as SVG.'
        : 'This file does not contain a readable PDF document.',
    );
  }
  const pdfjs = await import('pdfjs-dist');
  const owner = ownedPdfWorker(pdfjs);
  let task: PdfJs.PDFDocumentLoadingTask | null = null;
  try {
    task = loadDocument(pdfjs, data, owner.worker);
    const document = await owner.run(() => taskPromise(task));
    const pages = new Map<number, Promise<PreparedArtworkPage>>();
    const loadedTask = task;
    return {
      name: file.name,
      pageCount: document.numPages,
      prepare: (pageNumber) => {
        let prepared = pages.get(pageNumber);
        if (prepared === undefined) {
          prepared = owner.run(async () => {
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const operators = await page.getOperatorList({
              annotationMode: pdfjs.AnnotationMode.ENABLE,
            });
            const vector = pdfVectorPage(operators, pdfjs.OPS, viewport);
            return preparePage(page, viewport, vector, owner);
          });
          pages.set(pageNumber, prepared);
        }
        return prepared;
      },
      dispose: () => owner.dispose(loadedTask),
    };
  } catch (error) {
    await owner.dispose(task);
    throw new Error(
      'Could not read PDF. Password-protected files must be unlocked first. ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

function loadDocument(
  pdfjs: typeof PdfJs,
  data: Uint8Array<ArrayBuffer>,
  worker: PdfJs.PDFWorker,
): PdfJs.PDFDocumentLoadingTask {
  const resources = new URL(import.meta.env.BASE_URL + 'pdf-resources/', document.baseURI);
  const task = pdfjs.getDocument({
    data,
    worker,
    useWasm: false,
    stopAtErrors: true,
    useSystemFonts: false,
    cMapUrl: new URL('cmaps/', resources).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', resources).href,
    wasmUrl: new URL('wasm/', resources).href,
  });
  task.onPassword = (updatePassword: (password: Error) => void) => {
    updatePassword(new Error('Unlock this password-protected PDF before importing.'));
  };
  return task;
}

function taskPromise(task: PdfJs.PDFDocumentLoadingTask | null) {
  if (task === null) throw new Error('Could not start PDF parsing.');
  return task.promise;
}

async function preparePage(
  page: PdfJs.PDFPageProxy,
  viewport: { readonly width: number; readonly height: number },
  vector: ReturnType<typeof pdfVectorPage>,
  owner: OwnedPdfWorker,
): Promise<PreparedArtworkPage> {
  const scale = Math.min(1, 700 / Math.max(viewport.width, viewport.height));
  const preview = await renderPage(page, scale);
  return {
    widthMm: (viewport.width * 25.4) / 72,
    heightMm: (viewport.height * 25.4) / 72,
    thumbnail: preview.toDataURL('image/png'),
    vectorSvg: vector.svg,
    resolutionEditable: true,
    note:
      vector.reason ??
      'Editable paths preserve page size, curves and path colours. Strokes become cutting centrelines; choose Line or Fill after import. Use Image to keep the painted appearance.',
    render: (dpi) => owner.run(() => renderPage(page, dpi / 72)),
  };
}

async function renderPage(page: PdfJs.PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = pageCanvas(viewport.width, viewport.height);
  await page.render({ canvas, viewport, background: 'white' }).promise;
  return canvas;
}

type OwnedPdfWorker = {
  readonly worker: PdfJs.PDFWorker;
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly dispose: (task: PdfJs.PDFDocumentLoadingTask | null) => Promise<void>;
};

/** Passing an owned port prevents PDF.js's automatic main-thread fake worker. */
function ownedPdfWorker(pdfjs: typeof PdfJs): OwnedPdfWorker {
  const port = new Worker(workerUrl, { type: 'module' });
  let worker: PdfJs.PDFWorker;
  try {
    worker = pdfjs.PDFWorker.create({ port });
  } catch (error) {
    port.terminate();
    throw error;
  }
  let fail: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // A worker can fail between page requests, when no run() is awaiting it.
  void failure.catch(() => undefined);
  let terminalError: Error | null = null;
  let disposal: Promise<void> | null = null;
  const workerFailed = (): void => {
    terminalError = new Error('The PDF worker stopped. Close this import and try again.');
    fail(terminalError);
    port.terminate();
  };
  port.addEventListener('error', workerFailed);
  port.addEventListener('messageerror', workerFailed);
  return {
    worker,
    run: async (operation) => {
      if (terminalError !== null) throw terminalError;
      if (disposal !== null) throw new Error('PDF import closed.');
      return Promise.race([operation(), failure]);
    },
    dispose: (task) => {
      disposal ??= (async () => {
        try {
          // A dead port cannot answer PDF.js's Terminate message. Race its
          // disposal against the original worker failure instead of hanging.
          await Promise.race([task?.destroy() ?? Promise.resolve(), failure]);
        } catch {
          // The original read/render failure is reported to the import dialog.
        } finally {
          port.removeEventListener('error', workerFailed);
          port.removeEventListener('messageerror', workerFailed);
          port.terminate();
          worker.destroy();
        }
      })();
      return disposal;
    },
  };
}
