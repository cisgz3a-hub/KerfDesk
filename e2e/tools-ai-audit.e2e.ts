import { expect, test } from './fixtures/kerfdesk-test';

test.setTimeout(600_000);
test.use({ actionTimeout: 30_000 });

test('AI Assistant reviews valid geometry, commits once, undoes, cancels and rejects invalid drafts', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/tools-ai-audit.html', { waitUntil: 'commit' });
  const menu = page.locator('details[data-menu-family="tools"]');
  await expect(menu).toBeVisible({ timeout: 480_000 });
  const open = async () => {
    await menu.locator('summary').click();
    await menu.locator('[data-help-id="command:tools.ai-assistant"]').click();
  };
  const dialog = page.getByRole('dialog', { name: 'AI design and material assistant' });
  const count = page.getByLabel('Audit fixture status');
  const request = dialog.getByRole('button', { name: 'Request draft from OpenAI' });
  const prompt = dialog.getByLabel('AI prompt');
  await open();
  await prompt.fill('Create a triangle');
  await request.click();
  await expect(dialog.getByLabel('Generated vector preview')).toBeVisible();
  await expect(count).toContainText('0 artwork objects');
  await page.screenshot({ path: test.info().outputPath('ai-reviewed.png') });
  await dialog.getByRole('button', { name: 'Add reviewed design' }).click();
  await expect(dialog).toBeHidden();
  await expect(count).toContainText('1 artwork objects');
  await page.keyboard.press('Control+z');
  await expect(count).toContainText('0 artwork objects');
  await open();
  await prompt.fill('delay');
  await request.click();
  await dialog.getByRole('button', { name: 'Cancel request' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Request cancelled');
  await expect(dialog.getByLabel('Generated vector preview')).toBeHidden();
  await prompt.fill('invalid');
  await request.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add reviewed design' })).toBeHidden();
  await expect(count).toContainText('0 artwork objects');
  await page.screenshot({ path: test.info().outputPath('ai-invalid-rejected.png') });
});
