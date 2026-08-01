import { expect, test, type Page } from '@playwright/test';

const RESPONSIVE_EDIT_LIMIT_MS = 1_500;
const EXPENSIVE_WIDTH_MM = '300000';

test('Box Generator stays editable and cancellable during expensive generation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await runMenuCommand(page, 'Tools', 'Box Generator...');
  const dialog = page.getByRole('dialog', { name: 'Box Generator' });
  const generate = dialog.getByRole('button', { name: 'Generate', exact: true });
  await expect(dialog).toBeVisible();
  await expect(generate).toBeEnabled();

  await dialog.getByRole('spinbutton', { name: 'Finger width', exact: true }).fill('3');
  await expect(generate).toBeEnabled();
  await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill(EXPENSIVE_WIDTH_MM);
  await expect(dialog.getByRole('button', { name: 'Cancel preview generation' })).toBeVisible();

  const startedAt = performance.now();
  await dialog.getByRole('spinbutton', { name: 'Depth', exact: true }).fill('41');
  const editElapsedMs = performance.now() - startedAt;
  expect(editElapsedMs).toBeLessThan(RESPONSIVE_EDIT_LIMIT_MS);
  await expect(dialog.getByRole('spinbutton', { name: 'Depth', exact: true })).toHaveValue('41');

  await dialog.getByRole('button', { name: 'Cancel preview generation' }).click();
  await expect(dialog).toContainText('Preview generation cancelled');
  await expect(generate).toBeDisabled();

  await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('60');
  await expect(generate).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('Box Generator keeps flat and assembled previews available above 20,000 points', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await runMenuCommand(page, 'Tools', 'Box Generator...');
  const dialog = page.getByRole('dialog', { name: 'Box Generator' });
  const generate = dialog.getByRole('button', { name: 'Generate', exact: true });

  await dialog.getByRole('spinbutton', { name: 'Finger width', exact: true }).fill('3');
  await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('5000');
  await expect(generate).toBeEnabled();
  await expect(dialog).not.toContainText('Preview hidden for responsiveness');
  await expect(dialog.getByRole('img', { name: 'Generated panel sheet preview' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Assembled', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'Assembled box preview' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}
