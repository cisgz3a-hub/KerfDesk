import { expect, test } from './fixtures/kerfdesk-test';

test('keeps the multiplier in advanced settings and shows the resulting power', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('60');
  await power.press('Tab');
  await page
    .getByRole('tablist', { name: 'Edit artwork or operation', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
  const section = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Advanced artwork settings' }) });
  const multiplier = section.getByRole('spinbutton', { name: /Power multiplier for/ });
  await expect(multiplier).toBeHidden();
  await section.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(multiplier).toBeVisible();
  await multiplier.fill('50');
  await multiplier.press('Tab');
  await expect(section.getByLabel('Resulting artwork power')).toContainText('60% × 50% = 30%');
  await expect(multiplier).toHaveAttribute('title', /Multiply/);
  await expect(page.getByRole('button', { name: /^Dismiss notification:/ })).toHaveCount(0);
  await section.screenshot({ path: 'output/artwork-power-multiplier.png' });
  await section.locator('summary').click();
  await expect(multiplier).toBeHidden();
});
