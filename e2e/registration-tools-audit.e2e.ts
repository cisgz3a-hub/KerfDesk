import { test, expect } from '@playwright/test';

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 1000 }, actionTimeout: 30_000 });
test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/fixtures/registration-audit.html');
  await expect(
    page.getByRole('heading', { name: 'Registration tools — simulated inputs' }),
  ).toBeVisible({ timeout: 90_000 });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('workflow-result', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Camera: decode synthetic image, fit real lens model, review and save', async ({ page }) => {
  await page.getByRole('button', { name: 'Camera calibration workflow' }).click();
  await page.getByRole('button', { name: 'Target already engraved', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save calibration', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByText('These rings look like a target engraved with other settings.', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Accurate enough for placing artwork by eye.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save calibration', exact: true }).click();
  await expect(page.getByTestId('camera-saved')).toContainText('marks; RMS');
  const saved = await page.getByTestId('camera-saved').innerText();
  expect(Number(saved.match(/RMS ([\d.]+)/)?.[1])).toBeLessThan(0.3);
  const heldOut = await page.getByTestId('camera-held-out').innerText();
  expect(Number(heldOut.match(/height: ([\d.]+)/)?.[1])).toBeLessThan(0.4);
});

test('Place Board: four captures, outline, point correction and stale epoch refusal', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Place Board workflow' }).click();
  const panel = page.getByRole('region', { name: 'Place board', exact: true });
  for (const point of ['10,20', '110,20', '110,80', '10,80']) {
    await page.getByRole('button', { name: `Position ${point}`, exact: true }).click();
    await panel.getByRole('button', { name: 'Capture corner', exact: true }).click();
  }
  await expect(panel).toContainText('100.0 × 60.0 mm');
  await panel.getByRole('button', { name: 'Create board outline', exact: true }).click();
  await expect(page.getByTestId('board-result')).toContainText('captured-board');
  const verification = panel.getByRole('region', { name: 'Physically check board', exact: true });
  await verification.getByRole('button', { name: 'Top-right', exact: true }).click();
  await panel.getByRole('button', { name: 'No, adjust it', exact: true }).click();
  await page.getByRole('button', { name: 'Corrected position 111,80', exact: true }).click();
  await panel
    .getByRole('button', { name: 'Use current head position & update board', exact: true })
    .click();
  await expect(page.getByTestId('board-result')).toContainText('101');
  await page.getByRole('button', { name: 'Invalidate position epoch', exact: true }).click();
  await expect(verification.getByRole('button', { name: 'Top-right', exact: true })).toBeDisabled();
  await expect(panel).toContainText('machine coordinates changed');
});

test('Print and Cut: capture both marks, apply mapping, reopen and disable', async ({ page }) => {
  await page.getByRole('button', { name: 'Print and Cut workflow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Print and Cut', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Apply registration', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Capture head', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Second print mark 390,20', exact: true }).click();
  await dialog.getByRole('button', { name: 'Capture head', exact: true }).nth(1).click();
  await dialog.getByRole('button', { name: 'Apply registration', exact: true }).click();
  const mapping = JSON.parse(await page.getByTestId('print-result').innerText()) as {
    scale: number;
    translation: { x: number; y: number };
  };
  expect(mapping.scale).toBe(1);
  // Default bottom-left origin maps machine Y20 to scene Y380 on the 400 mm bed.
  expect(mapping.translation).toEqual({ x: 0, y: 370 });
  await page.getByRole('button', { name: 'Reopen Print and Cut', exact: true }).click();
  await expect(dialog).toContainText('Machine 390.000, 380.000');
  await dialog.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByTestId('print-result')).toHaveText('null');
});
