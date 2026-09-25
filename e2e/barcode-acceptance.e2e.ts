import { writeFile } from 'node:fs/promises';
import { decodeQrModules } from '../src/__fixtures__/barcode/qr-decoder';
import { sampleGrid } from '../src/__fixtures__/barcode/sample-geometry';
import { isBarcodeObject, type BarcodeObject } from '../src/core/barcode';
import { createProject } from '../src/core/scene';
import {
  barcodeAcceptanceHistory,
  barcodeAcceptanceSnapshot,
  openBarcodeAcceptanceProject,
  saveBarcodeAcceptanceProject,
} from './fixtures/barcode-acceptance-browser';
import { expect, test } from './fixtures/kerfdesk-test';
import { applicationHeader } from './fixtures/workspace-ui';

test.use({ viewport: { width: 1366, height: 900 } });

test('barcode inserts, edits, creates distinct variable copies, undoes and reopens', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(20_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(applicationHeader(page)).toContainText('KerfDesk', { timeout: 90_000 });
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await openBarcodeAcceptanceProject(
    page,
    kerfdesk,
    'barcode-empty.lf2',
    JSON.stringify(createProject()),
  );
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const emptyCanvas = await canvas.screenshot();
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Barcode...', exact: true }).click();
  const insertDialog = page.getByRole('dialog', { name: 'Insert Barcode', exact: true });
  await expect(insertDialog).toBeVisible();
  await insertDialog.getByLabel('Barcode data', { exact: true }).fill('SN-{{serial:4}}');
  await insertDialog.getByRole('checkbox', { name: 'Variable data', exact: true }).check();
  await insertDialog.getByLabel('Variable serial', { exact: true }).fill('41');
  await insertDialog.getByLabel('Variable serial', { exact: true }).press('Tab');
  const preview = insertDialog.getByRole('img', { name: /^Barcode preview:/ });
  await expect(preview.locator('path')).toHaveAttribute('fill-rule', 'evenodd');
  await preview.screenshot({ path: testInfo.outputPath('barcode-preview-SN0041.png') });
  const beforeInsert = await barcodeAcceptanceSnapshot(page);
  await insertDialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(insertDialog).toHaveCount(0);
  const inserted = await barcodeAcceptanceSnapshot(page);
  const original = required(inserted.project.scene.objects.filter(isBarcodeObject)[0]);
  expect(decodeBarcode(original)).toBe('SN-0041');
  expect(original.operationIds).toEqual([inserted.project.scene.layers[0]?.id]);
  expect(inserted.project.scene.layers[0]?.mode).toBe('fill');
  expect(original.paths[0]?.fillRule).toBe('evenodd');
  expect(original.paths[0]?.curves?.length).toBe(original.paths[0]?.polylines.length);
  expect(inserted.undoCount).toBe(beforeInsert.undoCount + 1);
  expect((await canvas.screenshot()).equals(emptyCanvas)).toBe(false);

  const sideTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await sideTab.isVisible()) await sideTab.click();
  await page
    .getByRole('tablist', { name: 'Edit artwork or operation', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit barcode…', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Barcode', exact: true });
  await expect(editDialog.getByLabel('Barcode data', { exact: true })).toHaveValue(
    'SN-{{serial:4}}',
  );
  await editDialog.getByLabel('Barcode data', { exact: true }).fill('LOT-{{serial:4}}');
  await editDialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editDialog).toHaveCount(0);
  const edited = await barcodeAcceptanceSnapshot(page);
  const editedCode = required(edited.project.scene.objects.filter(isBarcodeObject)[0]);
  expect(decodeBarcode(editedCode)).toBe('LOT-0041');
  expect(editedCode.id).toBe(original.id);
  expect(editedCode.transform).toEqual(original.transform);
  expect(editedCode.operationIds).toEqual(original.operationIds);
  expect(edited.undoCount).toBe(inserted.undoCount + 1);
  await barcodeAcceptanceHistory(page, false);
  await expect
    .poll(async () => (await barcodeAcceptanceSnapshot(page)).project.scene)
    .toEqual(inserted.project.scene);
  await barcodeAcceptanceHistory(page, true);
  await expect
    .poll(async () => (await barcodeAcceptanceSnapshot(page)).project.scene)
    .toEqual(edited.project.scene);
  await page.screenshot({ path: testInfo.outputPath('barcode-edited.png'), fullPage: true });

  await page.getByRole('menuitem', { name: 'Arrange', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Array...', exact: true }).click();
  const arrayDialog = page.getByRole('dialog', { name: 'Array', exact: true });
  await arrayDialog.getByLabel('Rows', { exact: true }).fill('2');
  await arrayDialog.getByLabel('Columns', { exact: true }).fill('3');
  await arrayDialog
    .getByRole('checkbox', { name: 'Advance variables per copy', exact: true })
    .check();
  await arrayDialog.getByRole('button', { name: 'Create array', exact: true }).click();
  await expect(arrayDialog).toHaveCount(0);
  const array = await barcodeAcceptanceSnapshot(page);
  const codes = array.project.scene.objects.filter(isBarcodeObject);
  const expected = ['LOT-0041', 'LOT-0042', 'LOT-0043', 'LOT-0044', 'LOT-0045', 'LOT-0046'];
  expect(codes.map(decodeBarcode)).toEqual(expected);
  expect(codes.map((code) => code.spec.variableTemplate?.sequenceOffset ?? 0)).toEqual([
    0, 1, 2, 3, 4, 5,
  ]);
  expect(codes.every((code) => code.spec.data === 'LOT-{{serial:4}}')).toBe(true);
  expect(array.project.variables?.serialValue).toBe(41);
  expect(array.undoCount).toBe(edited.undoCount + 1);
  await barcodeAcceptanceHistory(page, false);
  await expect
    .poll(async () => (await barcodeAcceptanceSnapshot(page)).project.scene)
    .toEqual(edited.project.scene);
  await barcodeAcceptanceHistory(page, true);
  await expect
    .poll(async () => (await barcodeAcceptanceSnapshot(page)).project.scene)
    .toEqual(array.project.scene);
  await page.screenshot({
    path: testInfo.outputPath('barcode-variable-array.png'),
    fullPage: true,
  });

  const saved = await saveBarcodeAcceptanceProject(page, kerfdesk);
  await writeFile(testInfo.outputPath('barcode-saved.lf2'), saved, 'utf8');
  await openBarcodeAcceptanceProject(page, kerfdesk, 'barcode-reopened.lf2', saved);
  const reopened = await barcodeAcceptanceSnapshot(page);
  expect(reopened.project.scene).toEqual(array.project.scene);
  expect(reopened.project.variables).toEqual(array.project.variables);
  expect(reopened.project.scene.objects.filter(isBarcodeObject).map(decodeBarcode)).toEqual(
    expected,
  );
  await page.screenshot({ path: testInfo.outputPath('barcode-reopened.png'), fullPage: true });
  const events = await kerfdesk.events();
  expect(events.filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
  expect(pageErrors).toEqual([]);
  await writeFile(
    testInfo.outputPath('barcode-state-evidence.json'),
    JSON.stringify({ inserted, edited, array, reopened, events, pageErrors }, null, 2),
    'utf8',
  );
  await writeFile(
    testInfo.outputPath('barcode-rendered-decoder-cases.json'),
    JSON.stringify(
      reopened.project.scene.objects.filter(isBarcodeObject).map((code, index) => ({
        id: `browser-reopened-${index}`,
        symbology: 'qr',
        expected: expected[index],
        invert: false,
        moduleMm: code.spec.moduleMm,
        bounds: code.bounds,
        polylines: code.paths.flatMap((path) => path.polylines),
      })),
    ),
    'utf8',
  );
});

function decodeBarcode(code: BarcodeObject): string {
  const quiet = code.spec.quietZoneModules;
  const moduleMm = code.spec.moduleMm;
  const size = Math.round((code.bounds.maxX - code.bounds.minX) / moduleMm) - 2 * quiet;
  const modules = sampleGrid(
    code.paths.flatMap((path) => path.polylines),
    size,
    size,
    moduleMm,
    { x: quiet * moduleMm, y: quiet * moduleMm },
  );
  const result = decodeQrModules(modules, size);
  if (!result.ok) throw new Error('Saved barcode outlines could not be decoded');
  return result.text;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected barcode acceptance evidence is missing');
  return value;
}
