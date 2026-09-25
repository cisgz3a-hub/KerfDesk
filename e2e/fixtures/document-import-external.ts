import { expect, test } from './kerfdesk-test';
import { composedSvgSnapshot } from './composed-svg-browser';
import {
  assertDocumentUndo,
  captureDocumentState,
  documentAssetCount,
  documentRaster,
  documentRasterSource,
  externalDocumentRoot,
  importDocumentFile,
  openDocumentPage,
  saveReopenDocument,
} from './document-import-browser';
import { compareDocumentReference, pinnedDocumentFile } from './document-import-reference';

export function registerDocumentExternalAcceptance() {
  test.describe('pinned upstream document corpus', () => {
    test.skip(
      externalDocumentRoot === undefined,
      'Set KERFDESK_DOCUMENT_CORPUS_ROOT to the separately attributed pinned corpus.',
    );
    for (const selectedPage of [1, 2, 8]) {
      test(`E3 PDF CropBox and rotation page ${selectedPage} renders and persists`, async ({
        page,
        kerfdesk,
      }, info) => {
        test.setTimeout(120_000);
        await page.goto('/');
        const dialog = await openDocumentPage(
          page,
          kerfdesk,
          pinnedDocumentFile('boxes.pdf'),
          selectedPage,
          selectedPage === 8,
        );
        await expect(dialog.getByText('boxes.pdf · 8 page(s)', { exact: true })).toBeVisible();
        await expect(dialog.getByLabel('Page import mode')).toHaveValue('image');
        await expect(dialog.locator('option[value="paths"]')).toHaveCount(0);
        await dialog.getByLabel('Page image resolution').fill('72');
        await page.screenshot({ path: info.outputPath('page-dialog.png') });
        await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
        await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
        const state = await captureDocumentState(page, info, 'imported');
        const raster = documentRaster(state.project.scene.objects[0]);
        const [width, height] = selectedPage === 1 ? [572, 732] : [732, 572];
        expect(raster.bounds.maxX).toBeCloseTo((Number(width) * 25.4) / 72, 7);
        expect(raster.bounds.maxY).toBeCloseTo((Number(height) * 25.4) / 72, 7);
        const metrics = await compareDocumentReference(
          page,
          info,
          documentRasterSource(raster),
          `E3-page-${selectedPage}-poppler-72dpi.png`,
          'poppler',
        );
        expect([metrics.width, metrics.height]).toEqual([width, height]);
        expect(metrics.topLeft).toEqual([0, 255, 0, 255]);
        // PDF.js and Poppler use different edge antialiasing. Preserve raw
        // metrics, then check flat regions and every coloured frame's coverage.
        expect(metrics.meanRgbDifference).toBeLessThan(5);
        expect(metrics.outsideReferenceEdgeFraction).toBeLessThan(0.0001);
        for (const color of metrics.frameColors) {
          expect(color.referencePixels).toBeGreaterThan(1000);
          expect(color.missingFraction).toBeLessThan(0.02);
        }
        await assertDocumentUndo(page, 1);
        await saveReopenDocument(page, kerfdesk, info);
      });
    }
    test('E4 PDF retains all six nested inline images and persists the whole page', async ({
      page,
      kerfdesk,
    }, info) => {
      test.setTimeout(120_000);
      await page.goto('/');
      const dialog = await openDocumentPage(
        page,
        kerfdesk,
        pinnedDocumentFile('nested-form-xobjects-inline-images.pdf'),
        1,
      );
      await expect(dialog.getByLabel('Page import mode')).toHaveValue('image');
      await expect(dialog.locator('option[value="paths"]')).toHaveCount(0);
      await dialog.getByLabel('Page image resolution').fill('72');
      await page.screenshot({ path: info.outputPath('page-dialog.png') });
      await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
      await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
      const state = await captureDocumentState(page, info, 'imported');
      const raster = documentRaster(state.project.scene.objects[0]);
      expect(raster.bounds.maxX).toBeCloseTo(215.9, 7);
      expect(raster.bounds.maxY).toBeCloseTo(279.4, 7);
      const metrics = await compareDocumentReference(
        page,
        info,
        documentRasterSource(raster),
        'E4-page-1-poppler-72dpi.png',
        'poppler',
      );
      expect([metrics.width, metrics.height]).toEqual([612, 792]);
      expect(metrics.patches).toHaveLength(6);
      for (const patch of metrics.patches) expect(patch.grayCoverage).toBeGreaterThan(0.99);
      expect(metrics.meanRgbDifference).toBeLessThan(2);
      expect(metrics.overEightFraction).toBeLessThan(0.025);
      await assertDocumentUndo(page, 1);
      await saveReopenDocument(page, kerfdesk, info);
    });
    for (const selectedPage of [1, 3, 2]) {
      test(`E5 TIFF page ${selectedPage} survives page changes and matches Pillow after insertion`, async ({
        page,
        kerfdesk,
      }, info) => {
        test.setTimeout(120_000);
        await page.goto('/');
        const dialog = await openDocumentPage(
          page,
          kerfdesk,
          pinnedDocumentFile('multipage.tiff'),
          1,
        );
        await expect(dialog.getByText('multipage.tiff · 3 page(s)', { exact: true })).toBeVisible();
        for (const current of [1, 3, 2, 1, selectedPage]) {
          await dialog.getByLabel('Page to import').fill(String(current));
          const preview = dialog.getByRole('img', { name: `Preview of page ${current}` });
          await expect(preview).toBeVisible();
          const src = await preview.getAttribute('src');
          if (src === null) throw new Error('Selected TIFF preview missing');
          const metrics = await compareDocumentReference(
            page,
            info,
            src,
            `E5-page-${current}-pillow.png`,
            `preview-${current}`,
          );
          expect(metrics.changed).toBe(0);
        }
        await expect(dialog.getByLabel('Page image resolution')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('page-dialog.png') });
        await dialog.getByRole('button', { name: 'Import page', exact: true }).click();
        await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
        const state = await captureDocumentState(page, info, 'imported');
        const raster = documentRaster(state.project.scene.objects[0]);
        const side = selectedPage === 3 ? 2 : 1;
        expect(raster.bounds).toEqual({ minX: 0, minY: 0, maxX: side, maxY: side });
        const metrics = await compareDocumentReference(
          page,
          info,
          documentRasterSource(raster),
          `E5-page-${selectedPage}-pillow.png`,
          'pillow',
        );
        expect(metrics.changed).toBe(0);
        await assertDocumentUndo(page, 1);
        await saveReopenDocument(page, kerfdesk, info);
      });
    }
    for (const [id, name, diagnostic] of [
      ['E2', 'masking-path-02-b.svg', /SVG vector clipping is not supported/],
      ['E6', 'spectrum.plt', /two-letter command|two letter command/i],
    ] as const) {
      test(`${id} ${name} rejects unsupported content without partial state`, async ({
        page,
        kerfdesk,
      }, info) => {
        await page.goto('/');
        const before = await composedSvgSnapshot(page);
        const assets = await documentAssetCount(page);
        await importDocumentFile(page, kerfdesk, pinnedDocumentFile(name));
        await expect(page.getByText(diagnostic)).toBeVisible();
        expect(await composedSvgSnapshot(page)).toEqual(before);
        expect(await documentAssetCount(page)).toBe(assets);
        await page.screenshot({ path: info.outputPath('rejected.png') });
      });
    }
  });
}
