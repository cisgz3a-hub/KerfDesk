import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test.setTimeout(180_000);
test.use({ actionTimeout: 30_000 });

test('Cancel during a pending filename lookup writes no files after the lookup resumes', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/tools-ai-audit.html');
  const controls = page.getByLabel('Synthetic file audit controls');
  await controls
    .getByRole('button', { name: 'Queue batch: duplicate square, ring, unreadable' })
    .click();
  await expect(controls).toContainText('4 files queued.');
  await controls.getByRole('button', { name: 'Pause next batch filename lookup' }).click();
  const menu = page.locator('details[data-menu-family="tools"]');
  await menu.locator('summary').click();
  await menu.locator('[data-help-id="command:tools.multi-file-trace"]').click();
  const batch = page.getByRole('dialog', { name: 'Multi-File Trace', exact: true });
  await batch.getByLabel('Trace settings').selectOption('preset');
  await batch.getByLabel('Trace preset').selectOption('Line Art');
  await batch.getByRole('button', { name: 'Choose Images...', exact: true }).click();
  await expect(batch).toContainText('4 images chosen.');
  await batch.getByRole('button', { name: 'Trace...', exact: true }).click();
  await expect(controls).toContainText('Filename lookup paused.');
  await page.getByRole('button', { name: 'Cancel Multi-File Trace', exact: true }).click();
  await controls.getByRole('button', { name: 'Resume pending filename lookup' }).click();
  await expect(
    page.getByText('Multi-File Trace cancelled. 0 of 4 images were written.'),
  ).toBeVisible();
  await expect(controls).toContainText('Captured exports: 0');
  await expect(controls.getByRole('listitem')).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('batch-cancel-no-write.png'),
    fullPage: true,
  });
});

test('32-image real trace batch preserves every duplicate output and skips one corrupt source', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/tools-ai-audit.html');
  const controls = page.getByLabel('Synthetic file audit controls');
  await controls
    .getByRole('button', { name: 'Queue stress: 32 duplicate images and one unreadable' })
    .click();
  await expect(controls).toContainText('33 files queued.');
  const menu = page.locator('details[data-menu-family="tools"]');
  await menu.locator('summary').click();
  await menu.locator('[data-help-id="command:tools.multi-file-trace"]').click();
  const batch = page.getByRole('dialog', { name: 'Multi-File Trace', exact: true });
  await batch.getByLabel('Trace settings').selectOption('preset');
  await batch.getByLabel('Trace preset').selectOption('Line Art');
  await batch.getByRole('button', { name: 'Choose Images...', exact: true }).click();
  await expect(batch).toContainText('33 images chosen.');
  await batch.getByRole('button', { name: 'Trace...', exact: true }).click();
  await expect(controls).toContainText('Captured exports: 32', { timeout: 90_000 });
  await expect(page.getByText(/Traced 32 images to SVG/)).toContainText('unreadable.png');
  const outputs = controls.getByRole('listitem');
  await expect(outputs).toHaveCount(32);
  const hashes: string[] = [];
  for (let index = 1; index <= 32; index += 1) {
    await expect(
      controls.getByRole('link', {
        name: `audit-square${index === 1 ? '' : `-${index}`}-trace.svg`,
        exact: true,
      }),
    ).toBeVisible();
  }
  for (const text of await outputs.allTextContents()) {
    const pathCount = Number(text.match(/(\d+) SVG paths/u)?.[1]);
    expect(pathCount).toBeGreaterThan(0);
    hashes.push(text.match(/SHA-256 ([a-f0-9]{64})/u)?.[1] ?? 'missing');
  }
  expect(new Set(hashes).size).toBe(1);
  expect(hashes[0]).not.toBe('missing');
  await page.screenshot({
    path: test.info().outputPath('batch-32-duplicates.png'),
    fullPage: true,
  });
});

test('visible synthetic file fixture verifies image codecs, source identity and duplicate batch exports', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/tools-ai-audit.html');
  const controls = page.getByLabel('Synthetic file audit controls');
  await expect(controls).toBeVisible();
  await controls.getByRole('button', { name: 'Queue one synthetic PNG for Import' }).click();
  await expect(controls).toContainText('1 files queued.');
  const sourceHash = (await controls.innerText()).match(
    /Square source SHA-256: ([a-f0-9]{64})/u,
  )?.[1];
  expect(sourceHash).toBeDefined();
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByLabel('Audit fixture status')).toContainText('1 artwork objects');
  const command = async (id: string) => {
    const menu = page.locator('details[data-menu-family="tools"]');
    await menu.locator('summary').click();
    await menu.locator(`[data-help-id="command:tools.${id}"]`).click();
  };
  for (const format of ['png', 'jpeg', 'bmp']) {
    await command('save-original-image');
    const dialog = page.getByRole('dialog', { name: 'Save Original Image', exact: true });
    await dialog.getByLabel('Image format').selectOption(format);
    await dialog.getByRole('button', { name: 'Save...', exact: true }).click();
    const extension = format === 'jpeg' ? 'jpg' : format;
    const output = controls
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: `audit-square.${extension}`, exact: true }) });
    await expect(output).toContainText('64 × 64 pixels; 2304 dark pixels');
    if (format === 'png') await expect(output).toContainText(sourceHash ?? 'missing hash');
  }
  await command('save-processed-bitmap');
  await expect(
    controls.getByRole('link', { name: 'audit-square-processed.png', exact: true }),
  ).toBeVisible();
  await controls
    .getByRole('button', { name: 'Queue batch: duplicate square, ring, unreadable' })
    .click();
  await expect(controls).toContainText('4 files queued.');
  await command('multi-file-trace');
  const batch = page.getByRole('dialog', { name: 'Multi-File Trace', exact: true });
  await batch.getByLabel('Trace settings').selectOption('preset');
  await batch.getByLabel('Trace preset').selectOption('Line Art');
  await batch.getByRole('button', { name: 'Choose Images...', exact: true }).click();
  await expect(batch).toContainText('4 images chosen.');
  await batch.getByRole('button', { name: 'Trace...', exact: true }).click();
  await expect(
    controls.getByRole('link', { name: 'audit-square-2-trace.svg', exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    controls.getByRole('link', { name: 'audit-ring-trace.svg', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Traced 3 images to SVG/)).toContainText('unreadable.png');
  await expect(controls).toContainText('Captured exports: 7');
  await expect(page.getByLabel('Audit fixture status')).toContainText('1 artwork objects');
  const originalExport = controls.getByRole('listitem').filter({
    has: page.getByRole('link', { name: 'audit-square-trace.svg', exact: true }),
  });
  const originalReceipt = await originalExport.innerText();
  await command('multi-file-trace');
  await batch.getByRole('button', { name: 'Choose Images...', exact: true }).click();
  await expect(batch).toContainText('4 images chosen.');
  await batch.getByRole('button', { name: 'Trace...', exact: true }).click();
  await expect(controls).toContainText('Captured exports: 10');
  await expect(
    controls.getByRole('link', { name: 'audit-square-trace-2.svg', exact: true }),
  ).toBeVisible();
  await expect(originalExport).toHaveText(originalReceipt);
  await page.screenshot({
    path: test.info().outputPath('visible-export-receipts.png'),
    fullPage: true,
  });
});
