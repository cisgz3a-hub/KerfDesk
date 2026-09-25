import { expect, test, type Page } from './kerfdesk-test';
import { composedSvgSnapshot, waitForSvgCanvas } from './composed-svg-browser';
import {
  captureDocumentState,
  documentAssetCount,
  documentFile,
  importDocumentFile,
  openDocumentPage,
} from './document-import-browser';

interface CanvasGate {
  held: boolean;
  completed: boolean;
  release: () => void;
}
type DocumentWindow = Window & { __documentCanvasGate: CanvasGate; __documentWorkerStops: number };

async function documentEpoch(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { projectDocumentEpoch: number } };
    };
    return loaded.useStore.getState().projectDocumentEpoch;
  });
}

async function trackDocumentWorkers(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as DocumentWindow;
    state.__documentWorkerStops = 0;
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      private readonly isDocumentWorker: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.isDocumentWorker = /pdf\.worker|tiff-import\.worker/.test(String(url));
      }
      override terminate() {
        if (this.isDocumentWorker) state.__documentWorkerStops++;
        super.terminate();
      }
    };
  });
}

export function registerDocumentCancellationAcceptance() {
  test('document chooser Cancel leaves scene history and assets unchanged', async ({
    page,
    kerfdesk,
  }, info) => {
    await trackDocumentWorkers(page);
    await page.goto('/');
    const before = await composedSvgSnapshot(page);
    const assets = await documentAssetCount(page);
    const dialog = await openDocumentPage(page, kerfdesk, documentFile('two-pages.pdf'), 2);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as DocumentWindow).__documentWorkerStops))
      .toBe(1);
    expect(await composedSvgSnapshot(page)).toEqual(before);
    expect(await documentAssetCount(page)).toBe(assets);
    await captureDocumentState(page, info, 'cancelled');
  });

  test('document Cancel during actual PNG encoding rejects a later encoder completion', async ({
    page,
    kerfdesk,
  }, info) => {
    await trackDocumentWorkers(page);
    await page.goto('/');
    const before = await composedSvgSnapshot(page);
    const assets = await documentAssetCount(page);
    const dialog = await openDocumentPage(page, kerfdesk, documentFile('two-pages.pdf'), 2);
    await page.evaluate(() => {
      const gate: CanvasGate = { held: false, completed: false, release: () => undefined };
      (window as unknown as DocumentWindow).__documentCanvasGate = gate;
      const native = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        if (!gate.held) {
          gate.held = true;
          gate.release = () =>
            native.call(
              this,
              (blob) => {
                callback(blob);
                gate.completed = true;
              },
              type,
              quality,
            );
          return;
        }
        native.call(this, callback, type, quality);
      };
    });
    await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as DocumentWindow).__documentCanvasGate.held),
      )
      .toBe(true);
    await expect(dialog.getByRole('button', { name: 'Importing…', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('held-real-encoder.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => (window as unknown as DocumentWindow).__documentCanvasGate.release());
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as DocumentWindow).__documentCanvasGate.completed),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as DocumentWindow).__documentWorkerStops))
      .toBe(1);
    await waitForSvgCanvas(page);
    expect(await composedSvgSnapshot(page)).toEqual(before);
    expect(await documentAssetCount(page)).toBe(assets);
    await captureDocumentState(page, info, 'late-completion-rejected');
  });

  test('document replacement while PDF worker loads prevents stale chooser and insertion', async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    await trackDocumentWorkers(page);
    let unblock: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let held = false;
    await page.goto('/');
    await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
    await page.route('**/pdf.worker.min.mjs', async (route) => {
      held = true;
      await blocked;
      await route.continue();
    });
    try {
      const epoch = await documentEpoch(page);
      await importDocumentFile(page, kerfdesk, documentFile('two-pages.pdf'));
      await expect.poll(() => held).toBe(true);
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New Ctrl+N', exact: true }).click();
      await expect.poll(() => documentEpoch(page)).toBe(epoch + 1);
      const replacement = await composedSvgSnapshot(page);
      unblock();
      await expect
        .poll(
          () => page.evaluate(() => (window as unknown as DocumentWindow).__documentWorkerStops),
          { timeout: 60_000 },
        )
        .toBe(1);
      await waitForSvgCanvas(page);
      await expect(page.getByRole('dialog', { name: 'Import document page' })).toHaveCount(0);
      expect(await composedSvgSnapshot(page)).toEqual(replacement);
      expect(await documentAssetCount(page)).toBe(0);
      await captureDocumentState(page, info, 'replacement-retained');
    } finally {
      unblock();
    }
  });
}
