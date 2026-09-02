import { expect, test } from './fixtures/kerfdesk-test';

test('keeps empty Preview reachable from toolbar, Window menu, and P', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });

  const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
  const emptyHint = page.getByText(
    'Nothing to preview — enable Output on at least one layer with objects.',
    { exact: true },
  );

  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(previewButton).toHaveAttribute('aria-pressed', 'true');
  await expect(emptyHint).toBeVisible();

  await page.getByText('Window', { exact: true }).click();
  const previewMenuItem = page.getByRole('menuitemcheckbox', { name: /^Preview(?:\s+P)?$/ });
  await expect(previewMenuItem).toBeEnabled();
  await previewMenuItem.click();
  await expect(previewButton).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('p');
  await expect(previewButton).toHaveAttribute('aria-pressed', 'true');
  await expect(emptyHint).toBeVisible();

  await page.keyboard.press('p');
  await expect(previewButton).toHaveAttribute('aria-pressed', 'false');
});
