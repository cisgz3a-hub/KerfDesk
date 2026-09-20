import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/kerfdesk-test';

async function toolbarPreview(page: Page) {
  await page.getByRole('button', { name: 'More commands', exact: true }).click();
  return page
    .getByRole('menu', { name: 'More commands', exact: true })
    .getByRole('menuitemcheckbox', { name: 'Preview', exact: true });
}

async function expectToolbarPreviewState(page: Page, active: boolean) {
  await expect(await toolbarPreview(page)).toHaveAttribute('aria-checked', String(active));
  await page.keyboard.press('Escape');
}

test('keeps empty Preview reachable from toolbar, Window menu, and P', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });

  const previewCommand = await toolbarPreview(page);
  const emptyHint = page.getByText(
    'Nothing to preview — enable Output on at least one layer with objects.',
    { exact: true },
  );

  await expect(previewCommand).toBeEnabled();
  await previewCommand.click();
  await expect(emptyHint).toBeVisible();
  await expectToolbarPreviewState(page, true);

  await page.getByText('Window', { exact: true }).click();
  const previewMenuItem = page.getByRole('menuitemcheckbox', { name: /^Preview(?:\s+P)?$/ });
  await expect(previewMenuItem).toBeEnabled();
  await previewMenuItem.click();
  await expectToolbarPreviewState(page, false);

  await page.keyboard.press('p');
  await expect(emptyHint).toBeVisible();
  await expectToolbarPreviewState(page, true);

  await page.keyboard.press('p');
  await expectToolbarPreviewState(page, false);
});
