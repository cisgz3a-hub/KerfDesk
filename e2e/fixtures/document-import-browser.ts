import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TestInfo } from '@playwright/test';
import type { RasterImage } from '../../src/core/scene';
import { expect, type KerfDeskFixture, type OpenFileFixture, type Page } from './kerfdesk-test';
import { composedSvgSnapshot, svgRedo, svgUndo } from './composed-svg-browser';
import { clearCanvasProject } from './mixed-canvas-project';
import { toolbarCommand } from './workspace-ui';

export const externalDocumentRoot = process.env['KERFDESK_DOCUMENT_CORPUS_ROOT'];

export function documentFile(name: string, external = false): OpenFileFixture {
  const path = external
    ? `${externalDocumentRoot}/fixtures/${name}`
    : fileURLToPath(new URL(`./document-import-generated/${name}`, import.meta.url));
  return { name, base64: readFileSync(path).toString('base64') };
}

export async function importDocumentFile(
  page: Page,
  fixture: KerfDeskFixture,
  file: OpenFileFixture,
  drop = false,
) {
  if (!drop) {
    await fixture.setOpenFiles([file]);
    await (await toolbarCommand(page, 'Import...')).click();
    return;
  }
  await page.evaluate((file) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(file.base64 ?? ''), (character) => character.charCodeAt(0));
    transfer.items.add(new File([bytes], file.name, { type: file.mimeType ?? '' }));
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, file);
}

export async function openDocumentPage(
  page: Page,
  fixture: KerfDeskFixture,
  file: OpenFileFixture,
  pageNumber: number,
  drop = false,
) {
  await importDocumentFile(page, fixture, file, drop);
  const dialog = page.getByRole('dialog', { name: 'Import document page' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('spinbutton', { name: 'Page to import' }).fill(String(pageNumber));
  await expect(dialog.getByRole('img', { name: `Preview of page ${pageNumber}` })).toBeVisible({
    timeout: 60_000,
  });
  await expect(dialog.getByRole('button', { name: 'Import page', exact: true })).toBeEnabled();
  return dialog;
}

export async function captureDocumentState(page: Page, info: TestInfo, name: string) {
  const state = await composedSvgSnapshot(page);
  writeFileSync(info.outputPath(`${name}-project.json`), JSON.stringify(state, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}-workspace.png`) });
  return state;
}

export async function saveReopenDocument(page: Page, fixture: KerfDeskFixture, info: TestInfo) {
  const original = (await composedSvgSnapshot(page)).project;
  const saves = (await fixture.events()).filter((event) => event.kind === 'file-saved').length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBe(saves + 1);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const saved = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (saved === undefined) throw new Error('Project save bytes missing');
  writeFileSync(info.outputPath('saved-project.lf2'), saved);
  await clearCanvasProject(page);
  await expect(page.getByText('Objects: 0', { exact: true })).toBeVisible();
  await fixture.setOpenFiles([{ name: 'document-roundtrip.lf2', text: saved }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/document-roundtrip\.lf2/);
  await expect(
    page.getByText(`Objects: ${original.scene.objects.length}`, { exact: true }),
  ).toBeVisible();
  const reopened = await captureDocumentState(page, info, 'reopened');
  expect(reopened.project.scene).toEqual(original.scene);
}

export async function assertDocumentUndo(page: Page, objects: number) {
  const state = await composedSvgSnapshot(page);
  expect(state.undoCount).toBe(1);
  await svgUndo(page, 0);
  expect((await composedSvgSnapshot(page)).undoCount).toBe(0);
  await svgRedo(page, objects);
  expect((await composedSvgSnapshot(page)).project).toEqual(state.project);
}

export function documentRaster(object: unknown): RasterImage {
  if (
    typeof object !== 'object' ||
    object === null ||
    !('kind' in object) ||
    object.kind !== 'raster-image'
  )
    throw new Error('Expected one raster image');
  return object as RasterImage;
}

export async function documentImagePixels(page: Page, src: string) {
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      rgba: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data],
    };
  }, src);
}

export function documentRasterSource(raster: RasterImage): string {
  const source = raster.dataUrl;
  if (source === undefined)
    throw new Error('Expected the full inline source for this small fixture, not a thumbnail');
  return source;
}

export async function documentAssetCount(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'curvedesk-import-assets-v1'))
      return 0;
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('curvedesk-import-assets-v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const count = db.transaction('manifests').objectStore('manifests').count();
        count.onsuccess = () => {
          resolve(count.result);
          db.close();
        };
        count.onerror = () => {
          reject(count.error);
          db.close();
        };
      };
    });
  });
}
