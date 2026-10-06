import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

for (const closeWith of ['Cancel', 'Escape'] as const) {
  test(`Cut Settings ${closeWith} restores its existing artwork control`, async ({ page }) => {
    await openArtwork(page);
    const opener = page.getByRole('button', { name: 'More cut settings', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: /^Cut settings for/ });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Cut settings mode', exact: true }),
    ).toBeFocused();
    if (closeWith === 'Cancel')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test(`Convert to Bitmap ${closeWith} restores the More commands fallback`, async ({ page }) => {
    await openArtwork(page);
    const opener = page.getByRole('button', { name: 'More commands', exact: true });
    await opener.click();
    await page
      .getByRole('menu', { name: 'More commands', exact: true })
      .getByRole('menuitem', { name: 'Convert to Bitmap...', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Convert to Bitmap', exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Convert render type', exact: true }),
    ).toBeFocused();
    if (closeWith === 'Cancel')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}

async function openArtwork(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
}
