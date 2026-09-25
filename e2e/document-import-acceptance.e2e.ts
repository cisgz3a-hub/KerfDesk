import { writeFileSync } from 'node:fs';
import { expect, test } from './fixtures/kerfdesk-test';
import {
  assertDocumentUndo,
  captureDocumentState,
  documentFile,
  documentImagePixels,
  documentRaster,
  documentRasterSource,
  importDocumentFile,
  openDocumentPage,
  saveReopenDocument,
} from './fixtures/document-import-browser';
import { composedSvgSnapshot } from './fixtures/composed-svg-browser';
import { registerDocumentExternalAcceptance } from './fixtures/document-import-external';
import { registerDocumentCancellationAcceptance } from './fixtures/document-import-cancellation';
import { registerDocumentCurveAcceptance } from './fixtures/document-import-curves';

test('document generated PDF selects editable paths and preserves them through Undo and reopen', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const dialog = await openDocumentPage(page, kerfdesk, documentFile('two-pages.pdf'), 1);
  await expect(dialog.getByText('two-pages.pdf · 2 page(s)', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Page import mode')).toHaveValue('paths');
  await expect(dialog.getByText('50.80 × 25.40 mm', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('page-dialog.png') });
  await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  const state = await captureDocumentState(page, info, 'imported');
  expect(state.project.scene.objects[0]?.kind).toBe('imported-svg');
  expect(workers.some((url) => url.includes('pdf.worker'))).toBe(true);
  expect(workers.some((url) => url.includes('document-import-worker'))).toBe(true);
  writeFileSync(info.outputPath('workers.json'), JSON.stringify(workers, null, 2));
  await assertDocumentUndo(page, 1);
  await saveReopenDocument(page, kerfdesk, info);
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});

for (const name of ['two-pages.pdf', 'compatible.ai']) {
  test(`document ${name} text page falls back to the complete image at chosen resolution`, async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const dialog = await openDocumentPage(page, kerfdesk, documentFile(name), 2);
    await expect(dialog.getByLabel('Page import mode')).toHaveValue('image');
    await expect(dialog.locator('option[value="paths"]')).toHaveCount(0);
    await dialog.getByLabel('Page image resolution').fill('144');
    await page.screenshot({ path: info.outputPath('page-dialog.png') });
    await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
    await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
    const state = await captureDocumentState(page, info, 'imported');
    const raster = documentRaster(state.project.scene.objects[0]);
    expect(raster.bounds.maxX - raster.bounds.minX).toBeCloseTo(50.8, 7);
    expect(raster.bounds.maxY - raster.bounds.minY).toBeCloseTo(25.4, 7);
    const pixels = await documentImagePixels(page, documentRasterSource(raster));
    expect([pixels.width, pixels.height]).toEqual([288, 144]);
    expect(
      pixels.rgba.filter((value, i) => i % 4 === 2 && value > Number(pixels.rgba[i - 2]) + 100)
        .length,
    ).toBeGreaterThan(100);
    await assertDocumentUndo(page, 1);
    await saveReopenDocument(page, kerfdesk, info);
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual(
      [],
    );
  });
}

test('document rotated TIFF page keeps the original pixel grid and density axes', async ({
  page,
  kerfdesk,
}, info) => {
  await page.goto('/');
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const dialog = await openDocumentPage(page, kerfdesk, documentFile('oriented-pages.tif'), 2);
  await expect(dialog.getByText('oriented-pages.tif · 2 page(s)', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Original 3 × 2 pixel grid preserved/)).toBeVisible();
  await expect(dialog.getByLabel('Page image resolution')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('page-dialog.png') });
  await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  const state = await captureDocumentState(page, info, 'imported');
  const raster = documentRaster(state.project.scene.objects[0]);
  expect([raster.bounds.maxX, raster.bounds.maxY]).toEqual([(3 * 25.4) / 200, (2 * 25.4) / 100]);
  const pixels = await documentImagePixels(page, documentRasterSource(raster));
  expect([pixels.width, pixels.height]).toEqual([3, 2]);
  expect(pixels.rgba.filter((_value, index) => index % 4 === 0)).toEqual([
    200, 100, 0, 250, 150, 50,
  ]);
  expect(workers.some((url) => url.includes('tiff-import.worker'))).toBe(true);
  await assertDocumentUndo(page, 1);
  await saveReopenDocument(page, kerfdesk, info);
});

for (const name of ['density-150x300.bmp', 'black-then-white.gif']) {
  test(`document ${name} preserves pixel meaning and survives reopen`, async ({
    page,
    kerfdesk,
  }, info) => {
    await page.goto('/');
    await importDocumentFile(page, kerfdesk, documentFile(name));
    await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
    const state = await captureDocumentState(page, info, 'imported');
    const raster = documentRaster(state.project.scene.objects[0]);
    const pixels = await documentImagePixels(page, documentRasterSource(raster));
    if (name.endsWith('.bmp')) {
      expect([pixels.width, pixels.height]).toEqual([8, 4]);
      // BMP density normalizes the encoded pixels/metre to whole DPI per axis.
      expect(raster.bounds.maxX - raster.bounds.minX).toBeCloseTo((8 * 25.4) / 150, 7);
      expect(raster.bounds.maxY - raster.bounds.minY).toBeCloseTo((4 * 25.4) / 300, 7);
      expect(pixels.rgba.filter((_value, index) => index % 4 === 0)).toEqual(
        Array.from({ length: 4 }, () => [0, 0, 0, 0, 255, 255, 255, 255]).flat(),
      );
    } else {
      expect([pixels.width, pixels.height]).toEqual([64, 32]);
      expect(documentRasterSource(raster)).toMatch(/^data:image\/png/);
      expect(
        pixels.rgba.filter((_value, index) => index % 4 !== 3).every((value) => value === 0),
      ).toBe(true);
    }
    await assertDocumentUndo(page, 1);
    await saveReopenDocument(page, kerfdesk, info);
  });
}

test('document valid HPGL retains ordered pen geometry through import and persistence', async ({
  page,
  kerfdesk,
}, info) => {
  await page.goto('/');
  await importDocumentFile(page, kerfdesk, documentFile('ordered-pens.plt'));
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  const state = await captureDocumentState(page, info, 'imported');
  const object = state.project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('Expected editable plotter geometry');
  expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 20 });
  expect(object.paths).toHaveLength(2);
  await assertDocumentUndo(page, 1);
  await saveReopenDocument(page, kerfdesk, info);
});

test('document legacy Illustrator rejection keeps the document and history unchanged', async ({
  page,
  kerfdesk,
}, info) => {
  await page.goto('/');
  const before = await composedSvgSnapshot(page);
  await importDocumentFile(page, kerfdesk, documentFile('legacy.ai'));
  await expect(
    page.getByText(/This Illustrator file has no PDF-compatible document/),
  ).toBeVisible();
  expect(await composedSvgSnapshot(page)).toEqual(before);
  await page.screenshot({ path: info.outputPath('rejected.png') });
});

test.afterEach(async ({ kerfdesk }, testInfo) => {
  // A corpus case skipped before navigation has no initialized page fixture.
  if (testInfo.status === 'skipped') return;
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});

registerDocumentExternalAcceptance();
registerDocumentCancellationAcceptance();
registerDocumentCurveAcceptance();
