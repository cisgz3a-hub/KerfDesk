import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('Machine Setup retains measurement drafts and Cancel leaves the saved profile unchanged', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Machine Setup', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await openDiagnostics(page);
  await enterLightBurnMeasurement(page);
  await page.getByText('Raster Diagnostics and assisted conversion', { exact: true }).click();
  await page.getByText('Raster Diagnostics and assisted conversion', { exact: true }).click();
  await expect(page.getByLabel('Measured offset 1', { exact: true })).toHaveValue('-0.1');
  await expect(page.getByLabel('Scan-offset speed unit', { exact: true })).toHaveValue(
    'mm-per-second',
  );
  await expect(page.getByRole('table', { name: 'Candidate scan-offset table' })).toContainText(
    '-0.2 mm',
  );
  await page.getByRole('button', { name: 'Apply measured offsets', exact: true }).click();
  await expect(page.getByText(/Verification pending: the table/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark verified', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Machine Setup', exact: true })
    .screenshot({ path: testInfo.outputPath('calibration-draft.png') });
  await page.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await openDiagnostics(page);
  await expect(page.getByLabel('Measured offset 1', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  const saved = Object.values(await kerfdesk.savedFiles());
  expect(saved.length).toBeGreaterThan(0);
  expect(JSON.parse(saved.at(-1) ?? '{}').device.scanningOffsets).toEqual([]);
  expect(errors).toEqual([]);
});

test('Machine Setup commits converted calibration once and restores it on reopen', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await openDiagnostics(page);
  await enterLightBurnMeasurement(page);
  await page.getByRole('button', { name: 'Apply measured offsets', exact: true }).click();
  await page.getByRole('button', { name: 'Go to step 6: Review & save', exact: true }).click();
  await page.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await openDiagnostics(page);
  await expect(page.getByLabel('Measured speed 1', { exact: true })).toHaveValue('3000');
  await expect(page.getByLabel('Measured offset 1', { exact: true })).toHaveValue('-0.2');
  await expect(page.getByText(/Verification pending: the table/)).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Machine Setup', exact: true })
    .screenshot({ path: testInfo.outputPath('calibration-saved.png') });
  await page.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  const saved = Object.values(await kerfdesk.savedFiles());
  expect(saved.length).toBeGreaterThan(0);
  const project = JSON.parse(saved.at(-1) ?? '{}');
  expect(project.device.scanningOffsets).toEqual([{ speedMmPerMin: 3000, offsetMm: -0.2 }]);
  expect(project.device.scanOffsetCalibrationStatus).toBe('pending');
  expect(errors).toEqual([]);
});

async function openDiagnostics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  await page
    .getByRole('button', { name: 'Go to step 5: Options & calibration', exact: true })
    .click();
  await page.getByText('Raster scan-offset calibration', { exact: true }).click();
  await page.getByText('Raster Diagnostics and assisted conversion', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Raster Diagnostics', exact: true }),
  ).toBeVisible();
}

async function enterLightBurnMeasurement(page: Page): Promise<void> {
  await page
    .getByLabel('Scan-offset input convention', { exact: true })
    .selectOption('lightburn-half-both-directions');
  await page.getByLabel('Scan-offset speed unit', { exact: true }).selectOption('mm-per-second');
  await page.getByLabel('Measured speed 1', { exact: true }).fill('50');
  await page.getByLabel('Measured offset 1', { exact: true }).fill('-0.1');
}
