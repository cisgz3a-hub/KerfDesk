import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

async function toolbarPreview(page: Page) {
  return toolbarCommand(page, 'Preview');
}

async function expectToolbarPreviewState(page: Page, active: boolean) {
  const preview = await toolbarPreview(page);
  const inMenu = (await preview.getAttribute('role')) === 'menuitemcheckbox';
  await expect(preview).toHaveAttribute(inMenu ? 'aria-checked' : 'aria-pressed', String(active));
  if (inMenu) await page.keyboard.press('Escape');
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
