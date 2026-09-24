import type { Project } from '../../src/core/scene';
import type { KerfDeskFixture, Page } from './kerfdesk-test';
import { expect } from './kerfdesk-test';
import { toolbarCommand } from './workspace-ui';

export interface ComposedSvgSnapshot {
  readonly project: Project;
  readonly undoCount: number;
  readonly redoCount: number;
}

export async function composedSvgSnapshot(page: Page): Promise<ComposedSvgSnapshot> {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          project: Project;
          undoStack: readonly unknown[];
          redoStack: readonly unknown[];
        };
      };
    };
    const state = loaded.useStore.getState();
    return {
      project: state.project,
      undoCount: state.undoStack.length,
      redoCount: state.redoStack.length,
    };
  });
}

export async function importComposedSvg(
  page: Page,
  kerfdesk: KerfDeskFixture,
  name: string,
  text: string,
  objects: number,
): Promise<void> {
  await kerfdesk.setOpenFiles([{ name, text }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByText(`Objects: ${objects}`, { exact: true })).toBeVisible();
  await waitForSvgCanvas(page);
}

export async function exportComposedSvg(page: Page, kerfdesk: KerfDeskFixture): Promise<string> {
  const previousSaves = (await kerfdesk.events()).filter(
    (event) => event.kind === 'file-saved',
  ).length;
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Export .*artwork as SVG/ }).click();
  await expect
    .poll(
      async () => (await kerfdesk.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBe(previousSaves + 1);
  const saved = Object.values(await kerfdesk.savedFiles()).find((text) => text.startsWith('<svg'));
  if (saved === undefined) throw new Error('SVG export did not write an SVG file');
  return saved;
}

export async function svgUndo(page: Page, expectedObjects: number): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByText(`Objects: ${expectedObjects}`, { exact: true })).toBeVisible();
  await waitForSvgCanvas(page);
}

export async function svgRedo(page: Page, expectedObjects: number): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText(`Objects: ${expectedObjects}`, { exact: true })).toBeVisible();
  await waitForSvgCanvas(page);
}

export async function waitForSvgCanvas(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Hold one real browser image decode so Esc can exercise the hydration boundary. */
export async function delaySecondSvgBitmap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { held: false, release: (): void => undefined };
    (window as Window & { __svgDecodeGate?: typeof state }).__svgDecodeGate = state;
    const files = new WeakMap<Blob, number>();
    const imageUrls = new Map<string, number>();
    const originalUrl = URL.createObjectURL.bind(URL);
    let fileCount = 0;
    URL.createObjectURL = (blob) => {
      const url = originalUrl(blob);
      if (blob instanceof File && blob.name === 'embedded.png') {
        if (!files.has(blob)) files.set(blob, ++fileCount);
        imageUrls.set(url, files.get(blob) ?? 0);
      }
      return url;
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (descriptor?.set === undefined) throw new Error('Native image src setter unavailable');
    const nativeSet = descriptor.set;
    let consumed = false;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(this: HTMLImageElement, value: string) {
        if (!consumed && imageUrls.get(value) === 2) {
          consumed = true;
          state.held = true;
          state.release = () => nativeSet.call(this, value);
          return;
        }
        nativeSet.call(this, value);
      },
    });
  });
}
